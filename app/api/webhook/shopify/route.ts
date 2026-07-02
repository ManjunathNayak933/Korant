// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/shopify/route.ts                               │
// │ Replace the existing file at <repo-root>/app/api/webhook/shopify/route.ts  │
// │                                                                            │
// │ Accepts orders two ways:                                                   │
// │  A) App-registered (Connect Shopify): signed with the app secret           │
// │     (SHOPIFY_API_SECRET), client identified by X-Shopify-Shop-Domain.      │
// │  B) Manual fallback: ?cid=&k= in the URL (per-client key).                 │
// │ Auto-captures the shop domain. Order data + attribution are identical for  │
// │ both paths.                                                                │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale, reverseSale } from '@/lib/attribution'
import { verifyShopifyHmacRaw } from '@/lib/shopify'

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
      .single()
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
      .single()
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

  // Refund / cancellation → reverse the original attribution.
  if (topic === 'refunds/create') {
    const orderId = String(order.order_id ?? order.order?.id ?? '')
    const r = await reverseSale({ clientId: client.id, orderId, platform: 'shopify', reason: 'refund' })
    return NextResponse.json({ received: true, reversed: r.reversed })
  }
  if (topic === 'orders/cancelled') {
    const orderId = String(order.id ?? '')
    const r = await reverseSale({ clientId: client.id, orderId, platform: 'shopify', reason: 'cancelled' })
    return NextResponse.json({ received: true, reversed: r.reversed })
  }

  // orders/paid always means paid. orders/create is registered too, so we catch
  // orders that arrive ALREADY paid via the Admin API (a third-party checkout
  // writing the finished order back into Shopify) — those never fire orders/paid
  // because there's no pending→paid transition. Only attribute an orders/create
  // once it's actually paid; a normal checkout fires both create + paid and
  // attributeSale dedupes on order_id, so there's no double-count.
  const financialStatus = String(order.financial_status || '').toLowerCase()
  if (topic === 'orders/create' && financialStatus !== 'paid') {
    return NextResponse.json({ received: true, attributed: false, skipped: 'not paid yet' })
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

  return NextResponse.json({ received: true, attributed: result.attributed, channel: result.channel })
}
