// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/cart/route.ts                                  │
// │                                                                            │
// │ Platform-NEUTRAL abandoned-cart intake. This is the universal contract —   │
// │ and it is the ONLY path that works for NON-NATIVE Shopify checkouts        │
// │ (GoKwik, Shiprocket Checkout, Razorpay Magic, Simpl, custom headless).     │
// │ Those checkouts bypass Shopify's own checkout, so Shopify never creates    │
// │ an AbandonedCheckout record and neither the CHECKOUTS_* webhooks nor the   │
// │ GraphQL abandonedCheckouts poll will ever see them. Fire this endpoint     │
// │ from your checkout provider instead.                                       │
// │                                                                            │
// │ WooCommerce plugins and storefront snippets use this too.                  │
// │ Auth: ?cid=<clientId>&k=<client webhook_secret>.                           │
// │ Public via middleware's `/api/webhook/` prefix.                            │
// │                                                                            │
// │ Body (application/json):                                                   │
// │ {                                                                          │
// │   "phone": "+91...", "email": "...", "name": "...",                        │
// │   "opted_in": true,                  // WhatsApp marketing consent          │
// │   "consent_known": true,             // optional — see note below           │
// │   "identity_source": "logged_in",    // logged_in | checkout | known_visitor│
// │   "cart_value": 1999, "currency": "INR",                                   │
// │   "items": [{"title":"Tee","qty":1,"price":1999}],                         │
// │   "recovery_url": "https://store/checkout/resume?token=...",               │
// │   "external_id": "cart_or_checkout_id"                                     │
// │ }                                                                          │
// │                                                                            │
// │ `recovery_url` matters: it is the link the shopper receives, so it must    │
// │ resume THEIR cart. `external_id` matters: send the same value on the order │
// │ webhook and the purchase matches this exact cart instead of guessing from  │
// │ phone/email.                                                               │
// │                                                                            │
// │ ── Fix in this revision (P3) ─────────────────────────────────────────────│
// │ This route never sent `consentKnown`, and intakeAbandonedCart defaults it  │
// │ to TRUE — so a storefront snippet that fires an update WITHOUT an          │
// │ opted_in field wrote opted_in = false over a cart another source had       │
// │ correctly opted in, silently unsubscribing the shopper mid-sequence.       │
// │                                                                            │
// │ The payload is now read three ways:                                        │
// │   • `opted_in` present            → consent OBSERVED, use its value        │
// │   • `opted_in` absent             → consent UNKNOWN, leave the row's alone │
// │   • `consent_known` sent explicitly → you decide (send `true` with         │
// │     `opted_in: false` to record a real, deliberate opt-OUT)                │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { intakeAbandonedCart } from '@/lib/cart-abandonment'
import { authenticateWebhook, pickField } from '@/lib/webhookAuth'

function cors(req: NextRequest) {
  const origin = req.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) })
}

// Only accept an http(s) recovery URL. A javascript:/data: value here would end
// up in a WhatsApp message and be tapped by a real customer.
function safeRecoveryUrl(raw: unknown): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : null
  } catch { return null }
}

export async function POST(request: NextRequest) {
  // Secret accepted as the x-webhook-secret header OR ?k= in the URL; client id
  // as ?clientId= or ?cid=. (QC B8 — both webhooks now authenticate the same way.)
  const auth = await authenticateWebhook(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: cors(request) })
  }
  const client = { id: auth.clientId! }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors(request) })
  }

  // Did this payload carry a consent field AT ALL? Absent ≠ declined.
  const sawConsent =
    body.opted_in !== undefined || body.optedIn !== undefined ||
    body.marketing_consent !== undefined || body.whatsapp_opt_in !== undefined ||
    body.sms_consent !== undefined
  const consentKnown = body.consent_known !== undefined
    ? body.consent_known === true || body.consent_known === 'true'
    : sawConsent

  // ── Tolerant field mapping ────────────────────────────────────────────────
  // We don't control what a checkout platform names its fields, and neither
  // does the brand. Rather than demand one exact shape, accept the common
  // aliases so more platforms work as-is. (For a platform that sends a wholly
  // different shape, a small adapter is still the answer — see the docs.)
  const phone = pickField(body, ['phone', 'phone_number', 'mobile', 'customer_phone', 'contact_phone', 'msisdn'])
  const email = pickField(body, ['email', 'customer_email', 'contact_email', 'user_email'])
  const name = pickField(body, ['name', 'customer_name', 'contact_name', 'first_name', 'full_name'])
  const cartValueRaw = pickField(body, ['cart_value', 'cartValue', 'total', 'amount', 'value', 'cart_total', 'grand_total', 'total_price'])
  const currency = pickField(body, ['currency', 'currency_code']) || 'INR'
  const items = pickField(body, ['items', 'line_items', 'lineItems', 'products', 'cart_items']) || []
  const recoveryRaw = pickField(body, ['recovery_url', 'recoveryUrl', 'checkout_url', 'abandoned_checkout_url', 'cart_url', 'resume_url', 'url'])
  const externalRaw = pickField(body, ['external_id', 'cart_id', 'checkout_id', 'cart_token', 'checkout_token', 'token', 'id'])
  const abandonedRaw = pickField(body, ['abandoned_at', 'abandonedAt', 'created_at', 'updated_at'])
  const identitySrc = pickField(body, ['identity_source', 'identitySource'])
  const optedInRaw = pickField(body, ['opted_in', 'optedIn', 'marketing_consent', 'whatsapp_opt_in', 'sms_consent'])

  const result = await intakeAbandonedCart({
    clientId: client.id,
    phone,
    email,
    name,
    // Strict boolean: only an explicit true is consent. `"false"`, `0` and
    // consent objects from other platforms must not opt someone in.
    optedIn: optedInRaw === true || optedInRaw === 'true' || optedInRaw === 1 || optedInRaw === '1',
    consentKnown,
    identitySource: identitySrc,
    cartValue: Number(cartValueRaw) || 0,
    currency,
    items: Array.isArray(items) ? items : [],
    recoveryUrl: safeRecoveryUrl(recoveryRaw),
    source: pickField(body, ['source']) || 'generic',
    externalId: externalRaw ? String(externalRaw) : null,
    // Optional: when the cart was really abandoned, if your checkout knows.
    // Defaults to now; anything unparseable or in the future is ignored.
    abandonedAt: abandonedRaw || null,
  })

  // ── B7: honest status codes ──────────────────────────────────────────────
  // This route used to return 200 even when the insert failed, so a provider's
  // webhook log showed "delivered" for a cart that was never stored and never
  // retried. Map the outcome:
  //   • stored            → 200
  //   • no_contact        → 200 (real no-op: no phone/email yet — retry can't help)
  //   • any other reason  → 502 (a real DB/config error — let the sender retry)
  if (!result.stored && result.reason && result.reason !== 'no_contact') {
    console.error('[webhook/cart] intake failed', {
      clientId: client.id, externalId: externalRaw ?? null,
      reason: result.reason,
    })
    return NextResponse.json(result, { status: 502, headers: cors(request) })
  }

  return NextResponse.json(result, { headers: cors(request) })
}
