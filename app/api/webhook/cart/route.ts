// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/cart/route.ts   (NEW FILE)                      │
// │ Create at <repo-root>/app/api/webhook/cart/route.ts                        │
// │                                                                            │
// │ Platform-NEUTRAL abandoned-cart intake. This is the universal contract —   │
// │ WooCommerce plugins, headless/custom checkouts, or the storefront snippet  │
// │ all POST here. Shopify has its own adapter (shopify-checkout) but could     │
// │ equally use this. Auth: ?cid=<clientId>&k=<client webhook_secret>, the     │
// │ same per-client key the manual Shopify order path uses.                    │
// │                                                                            │
// │ This path is already public via middleware's `/api/webhook/` prefix.       │
// │                                                                            │
// │ Body (application/json):                                                   │
// │ {                                                                          │
// │   "phone": "+91...", "email": "...", "name": "...",                        │
// │   "opted_in": true,                  // WhatsApp marketing consent          │
// │   "identity_source": "logged_in",    // logged_in | checkout | known_visitor│
// │   "cart_value": 1999, "currency": "INR",                                   │
// │   "items": [{"title":"Tee","qty":1,"price":1999}],                         │
// │   "recovery_url": "https://store/cart/...",                                │
// │   "external_id": "cart_or_checkout_id"   // for dedup on repeated updates   │
// │ }                                                                          │
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
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) })
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
    .from('clients').select('id, webhook_secret').eq('id', cid).single()
  if (!client || !client.webhook_secret || k !== client.webhook_secret) {
    return NextResponse.json({ error: 'Invalid client or key' }, { status: 401, headers: cors(request) })
  }

  let body: any
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors(request) })
  }

  const result = await intakeAbandonedCart({
    clientId: client.id,
    phone: body.phone,
    email: body.email,
    name: body.name,
    optedIn: !!body.opted_in,
    identitySource: body.identity_source,
    cartValue: Number(body.cart_value) || 0,
    currency: body.currency || 'INR',
    items: Array.isArray(body.items) ? body.items : [],
    recoveryUrl: body.recovery_url,
    source: body.source || 'generic',
    externalId: body.external_id ? String(body.external_id) : null,
  })

  return NextResponse.json(result, { headers: cors(request) })
}
