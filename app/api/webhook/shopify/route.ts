// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/shopify/route.ts                               │
// │                                                                            │
// │ Accepts orders two ways:                                                   │
// │  A) App-registered (Connect Shopify): signed with the app secret           │
// │     (SHOPIFY_API_SECRET), client identified by X-Shopify-Shop-Domain.      │
// │  B) Manual fallback: ?cid=&k= in the URL (per-client key).                 │
// │ Auto-captures the shop domain. Order data + attribution are identical for  │
// │ both paths.                                                                │
// │                                                                            │
// │ ── Fixes in this revision ────────────────────────────────────────────────│
// │ P0  COD ORDERS NEVER STOPPED THE ABANDONMENT SEQUENCE. The unpaid          │
// │     orders/create early-return sat ABOVE recoverCartsForOrder(), so a      │
// │     cash-on-delivery order — financial_status 'pending', and no            │
// │     orders/paid until someone captures it manually, often never — left     │
// │     the cart 'open' with a live next_step_at. The customer then received   │
// │     "you left something behind" on WhatsApp for up to expiry_days AFTER    │
// │     ordering, billed to us each time; and if the order was later marked    │
// │     paid, recoverCartsForOrder credited recovered_by_step = 3, so the tab  │
// │     reported those messages as having recovered the sale. On an India D2C  │
// │     store COD is most of the order volume.                                 │
// │                                                                            │
// │     The paid gate is CORRECT for attributeSale — you don't pay commission  │
// │     on an uncaptured order. It was never correct for standing the          │
// │     sequence down. The two are separated below.                            │
// │ P1  refunds/create and orders/cancelled returned before anything touched   │
// │     abandoned_carts, and reverseSale() only writes to `events`. A refunded │
// │     order stayed status = 'recovered' with its full recovered_value, so    │
// │     the tab's recovered revenue only ever went up. Both paths now call     │
// │     reverseCartRecovery().                                                 │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale, reverseSale } from '@/lib/attribution'
import { verifyShopifyHmacRaw } from '@/lib/shopify'
import { recoverCartsForOrder, reverseCartRecovery } from '@/lib/cart-abandonment'

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const cid = searchParams.get('cid')
  const k = searchParams.get('k')

  const body = await request.text()
  const sb = getSupabaseAdmin()

  let client: { id: string; shopify_domain: string | null } | null = null

  if (cid && k) {
    // ── Path B: manual fallback — identify by cid, authenticate by URL key ──
    const { data } = await sb
      .from('clients')
      .select('id, webhook_secret, shopify_domain')
      .eq('id', cid)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Unknown client' }, { status: 404 })
    if (!data.webhook_secret || k !== data.webhook_secret) {
      return NextResponse.json({ error: 'Invalid or missing key' }, { status: 401 })
    }
    client = { id: data.id, shopify_domain: data.shopify_domain }
  } else {
    // ── Path A: app-registered webhook — verify app-secret HMAC, find by shop ──
    const secret = process.env.SHOPIFY_API_SECRET || ''
    const hmac = request.headers.get('x-shopify-hmac-sha256')
      || request.headers.get('shopify-hmac-sha256') || ''
    const ok = await verifyShopifyHmacRaw(body, hmac, secret)
    if (!ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

    const shop = (request.headers.get('x-shopify-shop-domain') || '').toLowerCase()
    if (!shop) return NextResponse.json({ error: 'No shop domain' }, { status: 400 })
    const { data } = await sb
      .from('clients')
      .select('id, shopify_domain')
      .eq('shopify_domain', shop)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Store not connected' }, { status: 404 })
    client = { id: data.id, shopify_domain: data.shopify_domain }
  }

  const topic = request.headers.get('x-shopify-topic') || ''
  const shopDomain = (request.headers.get('x-shopify-shop-domain') || '').toLowerCase()

  // Learn the store's myshopify domain if we don't have it yet (mainly for the
  // manual path; the OAuth path already set it). Race-safe: only when null.
  if (shopDomain && !client.shopify_domain) {
    void sb.from('clients').update({ shopify_domain: shopDomain }).eq('id', client.id).is('shopify_domain', null)
  }

  let order: any
  try {
    order = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Refund / cancellation → reverse the original attribution AND the cart
  // recovery. reverseSale() only touches `events`; without the second call the
  // cart stays 'recovered' and its revenue is counted forever.
  if (topic === 'refunds/create') {
    const orderId = String(order.order_id ?? order.order?.id ?? '')
    const [r, c] = await Promise.all([
      reverseSale({ clientId: client.id, orderId, platform: 'shopify', reason: 'refund' }),
      reverseCartRecovery({ clientId: client.id, orderId }),
    ])
    return NextResponse.json({ received: true, reversed: r.reversed, cartsReversed: c.reversed })
  }
  if (topic === 'orders/cancelled') {
    const orderId = String(order.id ?? '')
    const [r, c] = await Promise.all([
      reverseSale({ clientId: client.id, orderId, platform: 'shopify', reason: 'cancelled' }),
      reverseCartRecovery({ clientId: client.id, orderId }),
    ])
    return NextResponse.json({ received: true, reversed: r.reversed, cartsReversed: c.reversed })
  }

  const financialStatus = String(order.financial_status || '').toLowerCase()
  const isUnpaidCreate = topic === 'orders/create' && financialStatus !== 'paid'

  // ── Cart abandonment runs FIRST, and for EVERY order, paid or not. ────────
  // An order existing at all is proof the shopper came back — that is the
  // signal to stop chasing them, regardless of whether the money has been
  // captured. Gating this behind `financial_status === 'paid'` is what kept
  // COD buyers in the sequence (see P0 in the header).
  //
  // Matches on the checkout token FIRST (exact — it's the same id intake
  // stored as external_id), then falls back to phone/email. Idempotent on
  // recovered_order_id, so the later orders/paid for the same purchase is a
  // cheap no-op. Best-effort: a failure here must never 500 the webhook, or
  // Shopify retries it and re-attributes the sale.
  try {
    await recoverCartsForOrder({
      clientId: client.id,
      phone: order.phone || order.customer?.phone || order.shipping_address?.phone || order.billing_address?.phone || null,
      email: order.email || order.customer?.email || null,
      orderId: String(order.id),
      orderValue: parseFloat(order.total_price || '0'),
      // Pass BOTH ids. Which one the cart is stored under depends on whether
      // the CHECKOUTS_* webhook (checkout_token) or the GraphQL poll
      // (checkout id) saw it first.
      externalId: order.checkout_token || null,
      externalIds: [order.checkout_id ? String(order.checkout_id) : null],
    })
  } catch (e) {
    console.error('[webhook/shopify] recoverCartsForOrder failed', { orderId: order.id, e: String(e) })
  }

  // ── Attribution keeps the paid gate. ─────────────────────────────────────
  // orders/paid always means paid. orders/create is registered too, so we catch
  // orders that arrive ALREADY paid via the Admin API (a third-party checkout
  // writing the finished order back into Shopify) — those never fire
  // orders/paid because there's no pending→paid transition. Commission must not
  // ride on an uncaptured order, so an unpaid orders/create stops here.
  if (isUnpaidCreate) {
    return NextResponse.json({
      received: true, attributed: false, skipped: 'not paid yet', cartSequenceStopped: true,
    })
  }

  const discountCode = order.discount_codes?.[0]?.code || null
  const noteAttributes: Record<string, string> = {}
  for (const attr of (order.note_attributes || [])) {
    noteAttributes[attr.name] = attr.value
  }

  const result = await attributeSale({
    clientId: client.id,
    orderValue: parseFloat(order.total_price || '0'),
    orderId: String(order.id),
    discountCode: discountCode || undefined,
    mkSlug: noteAttributes['mk_slug'] || undefined,
    mkSlugFirst: noteAttributes['mk_slug_first'] || undefined,
    platform: 'shopify',
  })

  // (Cart recovery already ran above, before the paid gate.)
  return NextResponse.json({ received: true, attributed: result.attributed, channel: result.channel })
}
