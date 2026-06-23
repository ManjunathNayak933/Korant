// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/market-view/route.ts
// │ Replace the existing file at <repo-root>/app/api/market-view/route.ts
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isProClient, platformHasEnoughData } from '@/lib/planLimits'

// `events` has no `channel` column — record_click and the sale-attribution inserts
// set the partner FK instead. Derive the channel from whichever FK is present,
// matching the taxonomy in lib/links.ts (influencer | seo | affiliate | direct).
type PartnerRow = { influencer_id?: string | null; publication_id?: string | null; affiliate_id?: string | null }
function channelOf(e: PartnerRow): string {
  if (e.influencer_id) return 'influencer'
  if (e.publication_id) return 'seo'
  if (e.affiliate_id) return 'affiliate'
  return 'direct'
}

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
    .select('id, type, order_value, influencer_id, publication_id, affiliate_id, visitor_id')
    .eq('client_id', userId)
    .eq(locField, location)
    .gte('timestamp', since)

  const { data: rawEvents } = await q
  // `channel` isn't a column — filter in memory using the derived channel.
  const events = channel ? (rawEvents || []).filter(e => channelOf(e) === channel) : (rawEvents || [])
  if (!events.length) return NextResponse.json({ empty: true, location })

  const clicks       = events.filter(e => e.type === 'click')
  const sales        = events.filter(e => e.type === 'code_sale' || e.type === 'cookie_sale')
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
    const ch = channelOf(e)
    if (!channelMap[ch]) channelMap[ch] = { clicks: 0, sales: 0, revenue: 0 }
    channelMap[ch].clicks++
  }
  for (const e of sales) {
    const ch = channelOf(e)
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

  // Buyer pincode — DISABLED: no data source yet. `events` has no `buyer_pincode`
  // column, and the order webhooks (shopify / razorpay / generic) don't capture a
  // shipping postcode, so there is nothing to aggregate. The previous query selected
  // a non-existent column, which errored and silently returned empty on every call.
  //
  // To enable: (1) add `buyer_pincode text` to the events table; (2) capture the
  // order's shipping postcode in the webhook event insert; (3) restore an aggregation
  // here filtering `.in('type', ['code_sale','cookie_sale'])` (NOT 'sale') and
  // grouping by buyer_pincode.
  const buyerData: any[] = []
  if (buyerMode) {
    // Feature gated off until the buyer_pincode data source above exists — no-op.
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
