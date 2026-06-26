// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/shopify/route.ts                               │
// │ Replace the existing file at <repo-root>/app/api/webhook/shopify/route.ts  │
// │                                                                            │
// │ Auth model change: the client is identified by ?cid= and authenticated by │
// │ ?k= (a per-client key in the webhook URL) instead of HMAC + shop-domain.   │
// │ The shop's myshopify domain is auto-captured from the first webhook so the │
// │ discount-code API still works without the customer typing it.              │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale, reverseSale } from '@/lib/attribution'

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('cid')
  const key = searchParams.get('k')

  if (!clientId) return NextResponse.json({ error: 'cid required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // Identify the client by the cid in the URL (no longer by shop domain).
  const { data: client } = await sb
    .from('clients')
    .select('id, webhook_secret, shopify_domain')
    .eq('id', clientId)
    .single()

  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 404 })

  // Authenticate with the per-client URL key. Fail closed: a live client MUST
  // have a key set, and the ?k= in the URL must match it. (The key is generated
  // for each client by /api/clients/integrations and shown in the setup screen.)
  if (!client.webhook_secret || key !== client.webhook_secret) {
    return NextResponse.json({ error: 'Invalid or missing key' }, { status: 401 })
  }

  const topic = request.headers.get('x-shopify-topic') || ''
  const shopDomain = request.headers.get('x-shopify-shop-domain') || ''

  // Convenience: learn and store the store's myshopify domain from the first
  // webhook (race-safe: only when not already set). The discount-code Admin API
  // needs the domain, so this lets auto-codes work without the customer typing
  // it. Runs in the background so it never delays the 200 back to Shopify.
  if (shopDomain && !client.shopify_domain) {
    void sb.from('clients')
      .update({ shopify_domain: shopDomain.trim().toLowerCase() })
      .eq('id', client.id)
      .is('shopify_domain', null)
  }

  const body = await request.text()

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
