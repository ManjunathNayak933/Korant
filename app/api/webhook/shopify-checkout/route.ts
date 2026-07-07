// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/shopify-checkout/route.ts   (NEW FILE)          │
// │ Create at <repo-root>/app/api/webhook/shopify-checkout/route.ts            │
// │                                                                            │
// │ Shopify ADAPTER for cart abandonment. Subscribed to CHECKOUTS_CREATE and   │
// │ CHECKOUTS_UPDATE (see registerShopifyCheckoutWebhooks in lib/shopify.ts).  │
// │ Shopify fires these when a shopper reaches checkout and enters details but │
// │ hasn't paid — that's the reachable "abandoned cart". We verify the app     │
// │ HMAC, normalise the checkout into the neutral shape, and hand it to        │
// │ intakeAbandonedCart(). The order webhook handles recovery separately.      │
// │                                                                            │
// │ Public via middleware's `/api/webhook/` prefix. Does NOT touch the         │
// │ existing order webhook.                                                    │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyShopifyHmacRaw } from '@/lib/shopify'
import { intakeAbandonedCart } from '@/lib/cart-abandonment'

export async function POST(request: NextRequest) {
  const raw = await request.text()

  // App-registered webhooks are signed with the one app secret.
  const secret = process.env.SHOPIFY_API_SECRET || ''
  const hmac = request.headers.get('x-shopify-hmac-sha256')
    || request.headers.get('shopify-hmac-sha256') || ''
  const ok = await verifyShopifyHmacRaw(raw, hmac, secret)
  if (!ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  const shop = (request.headers.get('x-shopify-shop-domain') || '').toLowerCase()
  if (!shop) return NextResponse.json({ error: 'No shop domain' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: client } = await sb
    .from('clients').select('id').eq('shopify_domain', shop).single()
  if (!client) return NextResponse.json({ error: 'Store not connected' }, { status: 404 })

  let checkout: any
  try { checkout = JSON.parse(raw) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Pull identity + cart out of the checkout object. Phone can live in a few
  // places depending on how far the shopper got; take the first present.
  const phone = checkout.phone
    || checkout.shipping_address?.phone
    || checkout.billing_address?.phone
    || checkout.customer?.phone
    || null
  const email = checkout.email || checkout.customer?.email || null

  const items = (checkout.line_items || []).map((li: any) => ({
    title: li.title, qty: li.quantity, price: parseFloat(li.price || '0'),
  }))

  // A logged-in customer means we knew them before checkout; otherwise this is a
  // checkout-entered identity. Meta marketing opt-in still has to be true — take
  // Shopify's SMS/marketing consent as the signal if present, else false.
  const identitySource = checkout.customer?.id ? 'logged_in' : 'checkout'
  const optedIn = !!(checkout.buyer_accepts_marketing || checkout.sms_marketing_consent)

  const result = await intakeAbandonedCart({
    clientId: client.id,
    phone,
    email,
    name: checkout.customer?.first_name
      ? `${checkout.customer.first_name} ${checkout.customer.last_name || ''}`.trim()
      : (checkout.billing_address?.name || null),
    optedIn,
    identitySource,
    cartValue: parseFloat(checkout.total_price || '0'),
    currency: checkout.currency || checkout.presentment_currency || 'INR',
    items,
    recoveryUrl: checkout.abandoned_checkout_url || null,
    source: 'shopify',
    externalId: checkout.token || String(checkout.id || ''),
  })

  return NextResponse.json({ received: true, ...result })
}
