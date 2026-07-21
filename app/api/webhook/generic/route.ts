// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/generic/route.ts                               │
// │                                                                            │
// │ Platform-neutral ORDER intake — this is the path NON-NATIVE Shopify        │
// │ checkouts use (GoKwik, Shiprocket Checkout, Razorpay Magic, Simpl, custom  │
// │ headless). Those checkouts never create a Shopify AbandonedCheckout, so    │
// │ the matching abandoned-cart intake is /api/webhook/cart. Both are keyed by │
// │ the same per-client webhook_secret and both accept an `external_id` /      │
// │ `cart_id` so a purchase can be matched EXACTLY back to its cart.          │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale, reverseSale } from '@/lib/attribution'
import { recoverCartsForOrder, reverseCartRecovery } from '@/lib/cart-abandonment'

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Verify secret
  const sb = getSupabaseAdmin()
  const { data: client } = await sb.from('clients').select('webhook_secret').eq('id', clientId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const webhookSecret = request.headers.get('x-webhook-secret')
  if (!client.webhook_secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
  }
  if (webhookSecret !== client.webhook_secret) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
  }

  // orderId is REQUIRED
  if (!body.orderId || String(body.orderId).trim() === '') {
    return NextResponse.json({
      error: 'orderId is required. Pass your platform\'s unique order ID. This prevents duplicate attribution on webhook retries. For testing use any unique string.'
    }, { status: 400 })
  }

  const eventType = body.eventType || 'sale'

  // ── Refund / return / cancellation ──────────────────────────────────────
  // Parity with the Shopify webhook (refunds/create + orders/cancelled): reverse
  // the original attribution, keyed by the SAME orderId the sale was sent with.
  // reverseSale marks the matching sale event(s) reversed (audit trail kept) and
  // is idempotent — a retried refund finds nothing left to reverse and no-ops.
  const REVERSAL_TYPES = new Set(['refund', 'return', 'cancel', 'cancelled', 'cancellation', 'reversal'])
  if (REVERSAL_TYPES.has(String(eventType).toLowerCase())) {
    const reason = /cancel/i.test(String(eventType)) ? 'cancelled' : 'refund'
    // reverseSale() only writes to `events`. Without the second call the
    // abandoned cart stays status = 'recovered' with its full recovered_value,
    // so the Cart Abandonment tab's recovered revenue only ever goes up.
    const [r, c] = await Promise.all([
      reverseSale({ clientId, orderId: String(body.orderId), platform: 'generic', reason }),
      reverseCartRecovery({ clientId, orderId: String(body.orderId) }),
    ])
    return NextResponse.json({ received: true, reversed: r.reversed, cartsReversed: c.reversed })
  }

  if (eventType === 'lead') {
    const mkSlug = body.mkSlug || body.mk_slug
    if (!mkSlug) return NextResponse.json({ error: 'mkSlug required for lead event' }, { status: 400 })
    const { data: affiliate } = await sb
      .from('affiliates')
      .select('id, name, client_id, campaign_id, commission_trigger')
      .eq('client_id', clientId)
      .eq('redirect_slug', mkSlug)
      .eq('is_active', true)
      .eq('commission_trigger', 'per_lead')
      .maybeSingle()

    if (affiliate) {
      await sb.from('events').insert({
        client_id: clientId,
        affiliate_id: affiliate.id,
        campaign_id: affiliate.campaign_id,
        type: 'cookie_sale',
        attribution_method: 'cookie',
        order_value: body.orderValue || 0,
        order_id: body.orderId,
        platform: 'generic',
        commission_amount: 0,
      })
      return NextResponse.json({ received: true, attributed: true, type: 'lead' })
    }
    return NextResponse.json({ received: true, attributed: false })
  }

  // ── Sale (incl. discount-code redemptions) ──────────────────────────────
  // Passing `discountCode` makes attributeSale resolve the sale by the partner's
  // checkout code exactly like the Shopify path — the code is stored on the
  // event row (discount_code) so redemptions are captured and queryable. If no
  // code is sent it falls back to slug/cookie attribution.
  const result = await attributeSale({
    clientId,
    orderValue: body.orderValue || 0,
    orderId: body.orderId,
    discountCode: body.discountCode || body.discount_code || undefined,
    mkSlug: body.mkSlug || body.mk_slug || undefined,
    mkSlugFirst: body.mkSlugFirst || body.mk_slug_first || undefined,
    platform: 'generic',
  })

  // Cart abandonment: if this buyer had an open abandoned-cart sequence, stop it
  // and credit the recovery to the message that was live.
  //
  // Pass `external_id` (or `cart_id`) — the SAME id you sent to
  // /api/webhook/cart — for an exact match. Phone/email is the fallback, and
  // can credit an unrelated older cart from a repeat buyer.
  await recoverCartsForOrder({
    clientId,
    phone: body.phone || body.customer_phone || null,
    email: body.email || body.customer_email || null,
    orderId: String(body.orderId),
    orderValue: body.orderValue || 0,
    externalId: body.external_id || body.externalId || body.cart_id || body.cartId || null,
  })

  return NextResponse.json({
    received: true,
    attributed: result.attributed,
    channel: result.channel,
    method: result.method,          // 'code' | 'cookie' | 'slug' — how it matched
    commission: result.commission,  // computed commission, if any
  })
}
