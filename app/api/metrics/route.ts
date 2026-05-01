export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { cacheGet, cacheSet, metricsKey } from '@/lib/cache'

export async function GET(request: NextRequest) {
  try {
    const role = request.headers.get('x-user-role')!
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
    const month = searchParams.get('month') || ''
    const campaignId = searchParams.get('campaignId') || ''
    const noCache = searchParams.get('noCache') === '1'

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
    if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const cKey = metricsKey(clientId, month, campaignId)
    if (!noCache) {
      const cached = await cacheGet(cKey)
      if (cached) return NextResponse.json(cached)
    }

    const sb = getSupabaseAdmin()
    let query = sb.from('events').select('*').eq('client_id', clientId)
    if (month) {
      query = query.gte('timestamp', `${month}-01`).lt('timestamp', `${month}-32`)
    }
    if (campaignId) query = query.eq('campaign_id', campaignId)

    const { data: eventsRaw, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const events = eventsRaw || []

    const clicks = events.filter((e: any) => e.type === 'click')
    const sales = events.filter((e: any) => e.type === 'code_sale' || e.type === 'cookie_sale')
    const codeSales = sales.filter((e: any) => e.type === 'code_sale')
    const revenue = sales.reduce((s: number, e: any) => s + (e.order_value || 0), 0)

    let infQuery = sb.from('influencers').select('id, name, handle, fee').eq('client_id', clientId)
    let pubQuery = sb.from('publications').select('id, publication_name, cost').eq('client_id', clientId)
    if (campaignId) {
      infQuery = infQuery.eq('campaign_id', campaignId)
      pubQuery = pubQuery.eq('campaign_id', campaignId)
    }

    const [infRes, pubRes, affRes] = await Promise.all([infQuery, pubQuery,
      sb.from('affiliates').select('id, name, handle').eq('client_id', clientId)])

    const influencers = infRes.data || []
    const publications = pubRes.data || []
    const affiliates = affRes.data || []

    const infFees = influencers.reduce((s: number, i: any) => s + (i.fee || 0), 0)
    const pubCosts = publications.reduce((s: number, p: any) => s + (p.cost || 0), 0)
    const totalBudget = infFees + pubCosts
    const convRate = clicks.length > 0 ? (sales.length / clicks.length) * 100 : 0
    const avgCostPerClick = clicks.length > 0 && totalBudget > 0 ? totalBudget / clicks.length : 0
    const avgCostPerSale = sales.length > 0 && totalBudget > 0 ? totalBudget / sales.length : 0

    const infMap: Record<string, any> = {}
    for (const inf of influencers) {
      infMap[inf.id] = {
        influencerId: inf.id, name: inf.name, handle: inf.handle, fee: inf.fee,
        clicks: 0, codeRedemptions: 0, cookieSales: 0, totalSales: 0, revenueAttributed: 0,
        cities: {}, referrers: {}, devices: { mobile: 0, desktop: 0, tablet: 0 },
      }
    }
    for (const e of events) {
      if (!e.influencer_id) continue
      const r = infMap[e.influencer_id]
      if (!r) continue
      if (e.type === 'click') {
        r.clicks++
        if (e.city) r.cities[e.city] = (r.cities[e.city] || 0) + 1
        if (e.referrer) r.referrers[e.referrer] = (r.referrers[e.referrer] || 0) + 1
        if (e.device) r.devices[e.device] = (r.devices[e.device] || 0) + 1
      }
      if (e.type === 'code_sale') r.codeRedemptions++
      if (e.type === 'cookie_sale') r.cookieSales++
      if (e.type !== 'click') { r.totalSales++; r.revenueAttributed += e.order_value || 0 }
    }
    const influencerStats = Object.values(infMap).map((r: any) => ({
      ...r,
      conversionRate: r.clicks > 0 ? (r.totalSales / r.clicks) * 100 : 0,
      avgCostPerClick: r.clicks > 0 ? r.fee / r.clicks : 0,
      topCity: Object.entries(r.cities).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || null,
      topReferrer: Object.entries(r.referrers).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || null,
      deviceBreakdown: r.devices,
    }))

    const geoPoints = clicks
      .filter((e: any) => e.lat && e.lon)
      .reduce((acc: any[], e: any) => {
        const key = `${e.lat},${e.lon}`
        const existing = acc.find((p: any) => `${p.lat},${p.lon}` === key)
        if (existing) existing.clicks++
        else acc.push({ city: e.city, country: e.country, lat: e.lat, lon: e.lon, clicks: 1 })
        return acc
      }, [])

    const ch = {
      influencer: {
        clicks: clicks.filter((e: any) => e.influencer_id).length,
        sales: sales.filter((e: any) => e.influencer_id).length,
        revenue: sales.filter((e: any) => e.influencer_id).reduce((s: number, e: any) => s + (e.order_value || 0), 0),
        budget: infFees,
      },
      seo: {
        clicks: clicks.filter((e: any) => e.publication_id).length,
        sales: sales.filter((e: any) => e.publication_id).length,
        revenue: sales.filter((e: any) => e.publication_id).reduce((s: number, e: any) => s + (e.order_value || 0), 0),
        budget: pubCosts,
      },
      affiliate: {
        clicks: clicks.filter((e: any) => e.affiliate_id).length,
        sales: sales.filter((e: any) => e.affiliate_id).length,
        revenue: sales.filter((e: any) => e.affiliate_id).reduce((s: number, e: any) => s + (e.order_value || 0), 0),
        budget: 0,
      },
    }

    let waQuery = sb.from('whatsapp_campaigns').select('sent, delivered, read, clicked, sales, revenue, status').eq('client_id', clientId).eq('status', 'sent')
    if (campaignId) waQuery = waQuery.eq('campaign_id', campaignId)
    const { data: waCampaigns } = await waQuery
    const waSent      = (waCampaigns || []).reduce((s: number, w: any) => s + (w.sent      || 0), 0)
    const waDelivered = (waCampaigns || []).reduce((s: number, w: any) => s + (w.delivered || 0), 0)
    const waRead      = (waCampaigns || []).reduce((s: number, w: any) => s + (w.read      || 0), 0)
    const waClicked   = (waCampaigns || []).reduce((s: number, w: any) => s + (w.clicked   || 0), 0)
    const waSales     = (waCampaigns || []).reduce((s: number, w: any) => s + (w.sales     || 0), 0)
    const waRevenue   = (waCampaigns || []).reduce((s: number, w: any) => s + (Number(w.revenue) || 0), 0)

    const result = {
      summary: {
        totalClicks: clicks.length + waClicked,
        totalSales: sales.length + waSales,
        codeRedemptions: codeSales.length,
        cookieSales: sales.length - codeSales.length,
        conversionRate: Math.round(convRate * 100) / 100,
        revenueAttributed: revenue + waRevenue,
        totalBudget,
        avgCostPerClick: Math.round(avgCostPerClick * 100) / 100,
        avgCostPerSale: Math.round(avgCostPerSale * 100) / 100,
      },
      channels: {
        ...ch,
        whatsapp: { sent: waSent, delivered: waDelivered, read: waRead, clicks: waClicked, sales: waSales, revenue: waRevenue, budget: 0 },
      },
      influencers: influencerStats,
      geoPoints,
      events: events.map((e: any) => ({
        type: e.type,
        influencer_id: e.influencer_id,
        publication_id: e.publication_id,
        affiliate_id: e.affiliate_id,
        order_value: e.order_value,
      })),
    }

    await cacheSet(cKey, result, 120)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('metrics error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}