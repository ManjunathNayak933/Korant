export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isProClient, platformHasEnoughData } from '@/lib/planLimits'
import { INDUSTRY_LABELS } from '@/lib/industries'

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
  const location      = searchParams.get('location') || ''   // city or country
  const locationType  = searchParams.get('locationType') || 'city' // 'city' | 'country'
  const channel       = searchParams.get('channel') || ''
  const industry      = searchParams.get('industry') || ''
  const dateRange     = searchParams.get('dateRange') || '30' // days
  const buyerMode     = searchParams.get('buyerMode') === 'true'

  if (!location) {
    // Return autocomplete suggestions — distinct cities/countries with click data
    const sb = getSupabaseAdmin()
    const field = locationType === 'country' ? 'country' : 'city'
    const { data } = await sb
      .from('events')
      .select(field)
      .eq('client_id', userId)
      .eq('type', 'click')
      .not(field, 'is', null)
      .limit(200)

    const suggestions = [...new Set((data || []).map((r: any) => r[field]).filter(Boolean))].sort()
    return NextResponse.json({ suggestions })
  }

  const sb = getSupabaseAdmin()
  const since = new Date(Date.now() - parseInt(dateRange) * 86400000).toISOString()
  const locField = locationType === 'country' ? 'country' : 'city'

  // Base event filter for this client + location + date
  let eventsQuery = sb
    .from('events')
    .select('id, type, order_value, influencer_id, visitor_id, timestamp')
    .eq('client_id', userId)
    .eq(locField, location)
    .gte('timestamp', since)

  if (channel) eventsQuery = eventsQuery.eq('channel', channel)

  const { data: events } = await eventsQuery
  if (!events?.length) {
    return NextResponse.json({ empty: true, location })
  }

  const clicks  = events.filter(e => e.type === 'click')
  const sales   = events.filter(e => e.type === 'sale')
  const revenue = sales.reduce((s, e) => s + (e.order_value || 0), 0)
  const uniqueVisitors = new Set(clicks.map(e => e.visitor_id).filter(Boolean)).size
  const convRate = clicks.length > 0 ? (sales.length / clicks.length) * 100 : 0

  // Top influencers for this location
  const infClickCounts: Record<string, number> = {}
  const infRevenue: Record<string, number> = {}
  for (const e of clicks) {
    if (e.influencer_id) infClickCounts[e.influencer_id] = (infClickCounts[e.influencer_id] || 0) + 1
  }
  for (const e of sales) {
    if (e.influencer_id) infRevenue[e.influencer_id] = (infRevenue[e.influencer_id] || 0) + (e.order_value || 0)
  }

  const topInfluencerIds = Object.entries(infClickCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id)

  let topInfluencers: any[] = []
  if (topInfluencerIds.length) {
    const { data: infData } = await sb
      .from('influencers')
      .select('id, name, handle, social_platform')
      .in('id', topInfluencerIds)
    topInfluencers = (infData || []).map(inf => ({
      ...inf,
      clicks:  infClickCounts[inf.id] || 0,
      revenue: infRevenue[inf.id] || 0,
    })).sort((a, b) => b.clicks - a.clicks)
  }

  // Category conversion breakdown — cross-platform aggregated, never per-brand
  // Shows how this location converts for each industry category
  const { data: catEvents } = await sb
    .from('events')
    .select('type, order_value, client_id')
    .eq(locField, location)
    .gte('timestamp', since)
    .in('type', ['click', 'sale'])

  const catMap: Record<string, { clicks: number; sales: number; revenue: number }> = {}
  if (catEvents?.length) {
    // Get industries for all clients in these events
    const clientIds = [...new Set(catEvents.map(e => e.client_id))]
    const { data: clientIndustries } = await sb
      .from('clients')
      .select('id, industry')
      .in('id', clientIds)
    const industryById: Record<string, string> = {}
    for (const c of clientIndustries || []) {
      if (c.industry) industryById[c.id] = c.industry
    }
    for (const e of catEvents) {
      const ind = industryById[e.client_id]
      if (!ind) continue
      if (industry && ind !== industry) continue
      if (!catMap[ind]) catMap[ind] = { clicks: 0, sales: 0, revenue: 0 }
      if (e.type === 'click') catMap[ind].clicks++
      if (e.type === 'sale')  { catMap[ind].sales++; catMap[ind].revenue += e.order_value || 0 }
    }
  }

  const categoryBreakdown = Object.entries(catMap).map(([ind, stats]) => ({
    industry: ind,
    label: INDUSTRY_LABELS[ind] || ind,
    clicks: stats.clicks,
    sales: stats.sales,
    revenue: stats.revenue,
    convRate: stats.clicks > 0 ? +((stats.sales / stats.clicks) * 100).toFixed(2) : 0,
  })).sort((a, b) => b.revenue - a.revenue)

  // Buyer pincode data (only when buyerMode is on)
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
    location,
    locationType,
    dateRange,
    summary: {
      clicks: clicks.length,
      sales: sales.length,
      revenue,
      uniqueVisitors,
      convRate: +convRate.toFixed(2),
    },
    topInfluencers,
    categoryBreakdown,
    buyerData,
    empty: false,
  })
}
