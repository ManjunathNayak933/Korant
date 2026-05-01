export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale } from '@/lib/attribution'

async function verifyShopifyHmac(body: string, hmacHeader: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const signatureBytes = Uint8Array.from(atob(hmacHeader), c => c.charCodeAt(0))
  return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(body))
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || ''
  const shopifyDomain = request.headers.get('x-shopify-shop-domain') || ''

  const sb = getSupabaseAdmin()

  // Find client by shopify domain
  const { data: client } = await sb
    .from('clients')
    .select('id, webhook_secret')
    .eq('shopify_domain', shopifyDomain)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Unknown shop domain' }, { status: 404 })
  }

  // Verify HMAC
  if (client.webhook_secret) {
    const valid = await verifyShopifyHmac(body, hmacHeader, client.webhook_secret)
    if (!valid) return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 })
  }

  let order: any
  try {
    order = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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
