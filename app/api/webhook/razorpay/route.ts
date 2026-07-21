// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/razorpay/route.ts                              │
// │                                                                            │
// │ BUG FIX: this handler never called recoverCartsForOrder(), unlike the      │
// │ Shopify and generic order webhooks. Razorpay brands therefore kept         │
// │ messaging customers who had already paid, and none of that recovered       │
// │ revenue was ever credited to the cart-abandonment activity.                │
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

  const body = await request.text()
  const sb = getSupabaseAdmin()

  const { data: client } = await sb.from('clients').select('webhook_secret').eq('id', clientId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Verify Razorpay's real signature: HMAC-SHA256(rawBody, webhook_secret) as hex,
  // delivered in the X-Razorpay-Signature header. Fail closed if no secret set.
  if (!client.webhook_secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
  }
  const sigHeader = request.headers.get('x-razorpay-signature') || ''
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(client.webhook_secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const computed = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('')
  // constant-time-ish compare
  let ok = computed.length === sigHeader.length
  for (let i = 0; i < computed.length && i < sigHeader.length; i++) {
    if (computed[i] !== sigHeader[i]) ok = false
  }
  if (!ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  let payload: any
  try { payload = JSON.parse(body) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Refund / reversal: Razorpay sends refund.created / refund.processed with the
  // original payment id (which we stored as the event's order_id). Reverse it.
  if (payload.event === 'refund.created' || payload.event === 'refund.processed') {
    const paymentId = payload.payload?.refund?.entity?.payment_id
    if (!paymentId) return NextResponse.json({ received: true, skipped: true })
    // reverseSale() only writes to `events`; the cart recovery needs undoing
    // too or its revenue stays on the Cart Abandonment tab forever.
    const [r, c] = await Promise.all([
      reverseSale({ clientId, orderId: String(paymentId), platform: 'razorpay', reason: 'refund' }),
      reverseCartRecovery({ clientId, orderId: String(paymentId) }),
    ])
    return NextResponse.json({ received: true, reversed: r.reversed, cartsReversed: c.reversed })
  }

  if (payload.event !== 'payment.captured') {
    return NextResponse.json({ received: true, skipped: true })
  }

  const payment = payload.payload?.payment?.entity || {}
  const notes = payment.notes || {}

  const result = await attributeSale({
    clientId,
    orderValue: (payment.amount || 0) / 100, // Razorpay amounts are in paise
    orderId: payment.id,
    discountCode: notes.discount_code || undefined,
    mkSlug: notes.mk_slug || undefined,
    mkSlugFirst: notes.mk_slug_first || undefined,
    platform: 'razorpay',
  })

  // Cart abandonment: stop the sequence and credit the recovery. Razorpay
  // exposes the buyer's contact on the payment entity; pass `cart_id` /
  // `external_id` in the order `notes` for an exact cart match (that's the same
  // id you sent to /api/webhook/cart from a non-native checkout).
  await recoverCartsForOrder({
    clientId,
    phone: payment.contact || notes.phone || null,
    email: payment.email || notes.email || null,
    orderId: String(payment.id),
    orderValue: (payment.amount || 0) / 100,
    externalId: notes.cart_id || notes.external_id || null,
  })

  return NextResponse.json({ received: true, attributed: result.attributed })
}
