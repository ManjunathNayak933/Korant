export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale } from '@/lib/attribution'

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Verify secret
  const sb = getSupabaseAdmin()
  const { data: client } = await sb.from('clients').select('webhook_secret').eq('id', clientId).single()
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
      .single()

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

  // Sale/discount
  const result = await attributeSale({
    clientId,
    orderValue: body.orderValue || 0,
    orderId: body.orderId,
    discountCode: body.discountCode || body.discount_code || undefined,
    mkSlug: body.mkSlug || body.mk_slug || undefined,
    mkSlugFirst: body.mkSlugFirst || body.mk_slug_first || undefined,
    platform: 'generic',
  })

  return NextResponse.json({ received: true, attributed: result.attributed, channel: result.channel })
}
