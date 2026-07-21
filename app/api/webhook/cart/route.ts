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
import { getSupabaseAdmin } from '@/lib/supabase'
import { intakeAbandonedCart } from '@/lib/cart-abandonment'

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
  const { searchParams } = new URL(request.url)
  const cid = searchParams.get('cid')
  const k = searchParams.get('k')
  if (!cid || !k) {
    return NextResponse.json({ error: 'cid and k required' }, { status: 401, headers: cors(request) })
  }

  const sb = getSupabaseAdmin()
  const { data: client } = await sb
    .from('clients').select('id, webhook_secret').eq('id', cid).maybeSingle()
  if (!client || !client.webhook_secret || k !== client.webhook_secret) {
    return NextResponse.json({ error: 'Invalid client or key' }, { status: 401, headers: cors(request) })
  }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors(request) })
  }

  // Did this payload carry a consent field AT ALL? Absent ≠ declined.
  const sawConsent =
    body.opted_in !== undefined || body.optedIn !== undefined
  const consentKnown = body.consent_known !== undefined
    ? body.consent_known === true || body.consent_known === 'true'
    : sawConsent

  const result = await intakeAbandonedCart({
    clientId: client.id,
    phone: body.phone,
    email: body.email,
    name: body.name,
    // Strict boolean: only an explicit true is consent. `"false"`, `0` and
    // consent objects from other platforms must not opt someone in.
    optedIn: body.opted_in === true || body.opted_in === 'true' || body.optedIn === true,
    consentKnown,
    identitySource: body.identity_source,
    cartValue: Number(body.cart_value) || 0,
    currency: body.currency || 'INR',
    items: Array.isArray(body.items) ? body.items : [],
    recoveryUrl: safeRecoveryUrl(body.recovery_url ?? body.recoveryUrl),
    source: body.source || 'generic',
    externalId: body.external_id ? String(body.external_id)
      : (body.cart_id ? String(body.cart_id) : null),
    // Optional: when the cart was really abandoned, if your checkout knows.
    // Defaults to now; anything unparseable or in the future is ignored.
    abandonedAt: body.abandoned_at || body.abandonedAt || null,
  })

  return NextResponse.json(result, { headers: cors(request) })
}
