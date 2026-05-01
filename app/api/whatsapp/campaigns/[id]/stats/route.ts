export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()

  const [{ data: campaign }, { data: messages }, { data: events }] = await Promise.all([
    sb.from('whatsapp_campaigns').select('*').eq('id', (await params).id).eq('client_id', userId).single(),
    sb.from('whatsapp_messages').select('status, phone, contact_name, delivered_at, read_at, clicked_at, error_message').eq('campaign_id', (await params).id).order('created_at', { ascending: false }).limit(200),
    sb.from('events').select('type, order_value').eq('client_id', userId).eq('attribution_method', 'slug').ilike('first_touch_slug', `wa-%`),
  ])

  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const msgs = messages || []
  const total = msgs.length
  const delivered = msgs.filter(m => m.status === 'delivered' || m.status === 'read').length
  const read = msgs.filter(m => m.status === 'read').length
  const clicked = msgs.filter(m => m.clicked_at).length
  const failed = msgs.filter(m => m.status === 'failed').length

  // Sales attributed via the campaign's tracking slug
  const clickEvents = (events || []).filter(e => e.type === 'click')
  const saleEvents = (events || []).filter(e => e.type !== 'click')
  const revenue = saleEvents.reduce((s, e) => s + (e.order_value || 0), 0)

  return NextResponse.json({
    campaign,
    stats: {
      total: campaign.total_contacts || total,
      sent: campaign.sent || total,
      delivered,
      read,
      clicked,
      failed,
      sales: saleEvents.length,
      revenue,
      deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(1) : '0',
      readRate: total > 0 ? ((read / total) * 100).toFixed(1) : '0',
      clickRate: total > 0 ? ((clicked / total) * 100).toFixed(1) : '0',
      conversionRate: clicked > 0 ? ((saleEvents.length / clicked) * 100).toFixed(1) : '0',
    },
    messages: msgs.slice(0, 50),
  })
}
