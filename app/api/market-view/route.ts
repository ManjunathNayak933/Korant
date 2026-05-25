export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isProClient, platformHasEnoughData } from '@/lib/planLimits'

export async function GET(request: NextRequest) {
  const role   = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!

  if (role !== 'client' && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (role === 'client') {
    const [pro, hasData] = await Promise.all([isProClient(userId), platformHasEnoughData()])
    if (!pro)     return NextResponse.json({ error: 'pro_required' }, { status: 403 })
    if (!hasData) return NextResponse.json({ error: 'insufficient_data' }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const location     = searchParams.get('location') || ''
  const locationType = searchParams.get('locationType') || 'city'
  const channel      = searchParams.get('channel') || ''
  const dateRange    = searchParams.get('dateRange') || '30'
  const buyerMode    = searchParams.get('buyerMode') === 'true'
  const locField     = locationType === 'country' ? 'country' : 'city'

  const sb = getSupabaseAdmin()

  // No location — return autocomplete from this client's own events only
  if (!location) {
    const { data } = await sb
      .from('events')
      .select(locField)
      .eq('client_id', userId)
      .eq('type', 'click')
      .not(locField, 'is', null)
      .limit(500)
    const suggestions = [...new Set((data || []).map((r: any) => r[locField]).filter(Boolean))].sort()
    return NextResponse.json({ suggestions })
  }

  const since = new Date(Date.now() - parseInt(dateRange) * 86400000).toISOString()

  // All events for this client in this location — strictly client-scoped
  let q = sb
    .from('events')
    .select('id, type, order_value, influencer_id, visitor_id, channel')
    .eq('client_id', userId)
    .eq(locField, location)
    .gte('timestamp', since)

  if (channel) q = q.eq('channel', channel)

  const { data: events } = await q
  if (!events?.length) return NextResponse.json({ empty: true, location })

  const clicks       = events.filter(e => e.type === 'click')
  const sales        = events.filter(e => e.type === 'sale')
  const revenue      = sales.reduce((s, e) => s + (e.order_value || 0), 0)
  const uniqueVisitors = new Set(clicks.map(e => e.visitor_id).filter(Boolean)).size
  const convRate     = clicks.length > 0 ? (sales.length / clicks.length) * 100 : 0

  // Top influencers for this location — this client's influencers only
  const infClicks: Record<string, number>  = {}
  const infRevenue: Record<string, number> = {}
  for (const e of clicks) {
    if (e.influencer_id) infClicks[e.influencer_id] = (infClicks[e.influencer_id] || 0) + 1
  }
  for (const e of sales) {
    if (e.influencer_id) infRevenue[e.influencer_id] = (infRevenue[e.influencer_id] || 0) + (e.order_value || 0)
  }
  const topIds = Object.entries(infClicks).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id)
  let topInfluencers: any[] = []
  if (topIds.length) {
    const { data: infData } = await sb
      .from('influencers')
      .select('id, name, handle, social_platform')
      .in('id', topIds)
    topInfluencers = (infData || []).map(inf => ({
      ...inf,
      clicks:  infClicks[inf.id]  || 0,
      revenue: infRevenue[inf.id] || 0,
    })).sort((a, b) => b.clicks - a.clicks)
  }

  // Channel breakdown for this location — this client's own data
  // Answers: which channel drives the most reach in this city?
  const channelMap: Record<string, { clicks: number; sales: number; revenue: number }> = {}
  for (const e of clicks) {
    const ch = e.channel || 'direct'
    if (!channelMap[ch]) channelMap[ch] = { clicks: 0, sales: 0, revenue: 0 }
    channelMap[ch].clicks++
  }
  for (const e of sales) {
    const ch = e.channel || 'direct'
    if (!channelMap[ch]) channelMap[ch] = { clicks: 0, sales: 0, revenue: 0 }
    channelMap[ch].sales++
    channelMap[ch].revenue += e.order_value || 0
  }
  const channelBreakdown = Object.entries(channelMap).map(([ch, stats]) => ({
    channel: ch,
    label: ch.charAt(0).toUpperCase() + ch.slice(1),
    clicks: stats.clicks,
    sales: stats.sales,
    revenue: stats.revenue,
    convRate: stats.clicks > 0 ? +((stats.sales / stats.clicks) * 100).toFixed(2) : 0,
  })).sort((a, b) => b.clicks - a.clicks)

  // Buyer pincode — this client's own sales only
  let buyerData: any[] = []
  if (buyerMode) {
    const { data: buyerEvents } = await sb
      .from('events')
      .select('buyer_pincode, order_value')
      .eq('client_id', userId)
      .eq('type', 'sale')
      .gte('timestamp', since)
      .not('buyer_pincode', 'is', null)
    const pincodeMap: Record<string, { orders: number; revenue: number }> = {}
    for (const e of buyerEvents || []) {
      if (!e.buyer_pincode) continue
      if (!pincodeMap[e.buyer_pincode]) pincodeMap[e.buyer_pincode] = { orders: 0, revenue: 0 }
      pincodeMap[e.buyer_pincode].orders++
      pincodeMap[e.buyer_pincode].revenue += e.order_value || 0
    }
    buyerData = Object.entries(pincodeMap)
      .map(([pincode, s]) => ({ pincode, ...s }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 20)
  }

  return NextResponse.json({
    location, locationType, dateRange,
    summary: {
      clicks: clicks.length, sales: sales.length,
      revenue, uniqueVisitors, convRate: +convRate.toFixed(2),
    },
    topInfluencers,
    channelBreakdown,
    buyerData,
    empty: false,
  })
}
