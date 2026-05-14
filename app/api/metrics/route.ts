export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { cacheGet, cacheSet, metricsKey } from '@/lib/cache'

// ─── Types ───────────────────────────────────────────────────────────────────
interface PartnerRow {
  partner_id: string; partner_type: 'influencer' | 'publication' | 'affiliate'
  clicks: number; sales: number; code_sales: number; cookie_sales: number
  revenue: number; commission: number; campaign_id: string | null
}

export async function GET(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const role   = request.headers.get('x-user-role')!
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)
    const clientId   = searchParams.get('clientId') || (role === 'client' ? userId : null)
    const month      = searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const campaignId = searchParams.get('campaignId') || ''
    const noCache    = searchParams.get('noCache') === '1'

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
    if (role === 'client' && clientId !== userId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Agency IDOR check
    if (role === 'agency') {
      const sb0 = getSupabaseAdmin()
      const { data: rel } = await sb0
        .from('agency_clients').select('client_id')
        .eq('agency_id', userId).eq('client_id', clientId).maybeSingle()
      if (!rel) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Cache ───────────────────────────────────────────────────────────────
    const cKey = metricsKey(clientId, month, campaignId)
    if (!noCache) {
      const cached = await cacheGet(cKey)
      if (cached) return NextResponse.json(cached)
    }

    const sb = getSupabaseAdmin()

    // ── 1. Partner stats — pre-aggregated, reads ~10 rows not 100K events ──
    //    Populated by trigger on events table (see supabase-stats-setup.sql)
    let statsQuery = sb
      .from('partner_stats_monthly')
      .select('partner_id, partner_type, clicks, sales, code_sales, cookie_sales, revenue, commission')
      .eq('client_id', clientId)
      .eq('month', month)
    if (campaignId) statsQuery = statsQuery.eq('campaign_id', campaignId)
    else            statsQuery = statsQuery.is('campaign_id', null)

    // ── 2. Partner metadata (tiny tables — always fast) ────────────────────
    let infQuery = sb.from('influencers')
      .select('id, name, handle, fee, redirect_slug, discount_code, social_platform, is_active, created_at, campaign_id')
      .eq('client_id', clientId)
    let pubQuery = sb.from('publications')
      .select('id, publication_name, cost, redirect_slug, is_active, created_at, campaign_id')
      .eq('client_id', clientId)
    let affQuery = sb.from('affiliates')
      .select('id, name, handle')
      .eq('client_id', clientId)
    if (campaignId) {
      infQuery = infQuery.eq('campaign_id', campaignId)
      pubQuery = pubQuery.eq('campaign_id', campaignId)
      affQuery = affQuery.eq('campaign_id', campaignId)
    }

    // ── 3. WhatsApp campaigns ───────────────────────────────────────────────
    let waQuery = sb.from('whatsapp_campaigns')
      .select('sent, delivered, read, clicked, sales, revenue')
      .eq('client_id', clientId).eq('status', 'sent')
    if (campaignId) waQuery = waQuery.eq('campaign_id', campaignId)

    // ── 4. Geo — GROUP BY server-side via RPC (returns ~20 rows, not 100K) ─
    const geoQuery = sb.rpc('get_geo_stats', {
      p_client_id:   clientId,
      p_month:       month,
      p_campaign_id: campaignId || null,
    })

    // Fire all queries in parallel
    const [statsRes, infRes, pubRes, affRes, waRes, geoRes] = await Promise.all([
      statsQuery, infQuery, pubQuery, affQuery, waQuery, geoQuery,
    ])

    const partnerStats: PartnerRow[] = statsRes.data || []
    const influencers  = infRes.data  || []
    const publications = pubRes.data  || []
    const affiliates   = affRes.data  || []
    const waCampaigns  = waRes.data   || []
    const geoPoints    = (geoRes.data || []) as { city: string; country: string; lat: number; lon: number; clicks: number }[]

    // ── 5. Budget — still using creation-date filter (existing behaviour) ──
    const nm = new Date(month + '-01')
    nm.setMonth(nm.getMonth() + 1)
    const nms = nm.toISOString().slice(0, 10)
    const infFees  = influencers .filter(i => i.created_at >= `${month}-01` && i.created_at < nms).reduce((s, i) => s + (i.fee  || 0), 0)
    const pubCosts = publications.filter(p => p.created_at >= `${month}-01` && p.created_at < nms).reduce((s, p) => s + (p.cost || 0), 0)
    const totalBudget = infFees + pubCosts

    // ── 6. Build lookup maps from metadata ──────────────────────────────────
    const infMeta: Record<string, typeof influencers[number]>   = {}
    const pubMeta: Record<string, typeof publications[number]>  = {}
    const affMeta: Record<string, typeof affiliates[number]>    = {}
    influencers .forEach(i => { infMeta[i.id] = i })
    publications.forEach(p => { pubMeta[p.id] = p })
    affiliates  .forEach(a => { affMeta[a.id] = a })

    // ── 7. Build per-partner stats arrays ───────────────────────────────────
    const influencerStats = partnerStats
      .filter(p => p.partner_type === 'influencer' && infMeta[p.partner_id])
      .map(p => {
        const meta = infMeta[p.partner_id]
        return {
          influencerId:    p.partner_id,
          name:            meta.name,
          handle:          meta.handle,
          fee:             meta.fee,
          redirect_slug:   meta.redirect_slug,
          discount_code:   meta.discount_code,
          social_platform: meta.social_platform,
          is_active:       meta.is_active,
          clicks:          p.clicks,
          codeRedemptions: p.code_sales,
          cookieSales:     p.cookie_sales,
          totalSales:      p.sales,
          revenueAttributed: p.revenue,
          conversionRate:  p.clicks > 0 ? (p.sales / p.clicks) * 100 : 0,
          avgCostPerClick: p.clicks > 0 && meta.fee > 0 ? meta.fee / p.clicks : 0,
          // Drill-down stats (topCity, deviceBreakdown, topReferrer) are loaded
          // lazily via /api/influencer-stats/:id to avoid per-row event reads
          topCity:         null,
          topReferrer:     null,
          deviceBreakdown: null,
        }
      })

    const publicationStats = partnerStats
      .filter(p => p.partner_type === 'publication' && pubMeta[p.partner_id])
      .map(p => {
        const meta = pubMeta[p.partner_id]
        return {
          publicationId:   p.partner_id,
          name:            meta.publication_name,
          cost:            meta.cost,
          redirect_slug:   meta.redirect_slug,
          is_active:       meta.is_active,
          clicks:          p.clicks,
          sales:           p.sales,
          revenue:         p.revenue,
          codeRedemptions: p.code_sales,
          conversionRate:  p.clicks > 0 ? (p.sales / p.clicks) * 100 : 0,
          costPerClick:    p.clicks > 0 && meta.cost > 0 ? meta.cost / p.clicks : 0,
        }
      })

    const affiliateStats = partnerStats
      .filter(p => p.partner_type === 'affiliate' && affMeta[p.partner_id])
      .map(p => {
        const meta = affMeta[p.partner_id]
        return {
          affiliateId:     p.partner_id,
          name:            meta.name,
          handle:          meta.handle,
          clicks:          p.clicks,
          sales:           p.sales,
          revenue:         p.revenue,
          commission:      p.commission,
          codeRedemptions: p.code_sales,
          cookieSales:     p.cookie_sales,
          conversionRate:  p.clicks > 0 ? (p.sales / p.clicks) * 100 : 0,
        }
      })

    // ── 8. Channel totals — sum from partnerStats ───────────────────────────
    const sumBy = (type: string, field: keyof PartnerRow) =>
      partnerStats.filter(p => p.partner_type === type).reduce((s, p) => s + (Number(p[field]) || 0), 0)

    const infClicks  = sumBy('influencer',  'clicks');  const infSales  = sumBy('influencer',  'sales');  const infRev  = sumBy('influencer',  'revenue'); const infCode  = sumBy('influencer',  'code_sales')
    const seoClicks  = sumBy('publication', 'clicks');  const seoSales  = sumBy('publication', 'sales');  const seoRev  = sumBy('publication', 'revenue'); const seoCode  = sumBy('publication', 'code_sales')
    const affClicks  = sumBy('affiliate',   'clicks');  const affSales  = sumBy('affiliate',   'sales');  const affRev  = sumBy('affiliate',   'revenue'); const affCode  = sumBy('affiliate',   'code_sales')

    const totalClicks = infClicks + seoClicks + affClicks
    const totalSales  = infSales  + seoSales  + affSales
    const totalRev    = infRev    + seoRev    + affRev

    // ── 9. WhatsApp totals ──────────────────────────────────────────────────
    const sumWa = (k: string) => waCampaigns.reduce((s: number, w: any) => s + (Number(w[k]) || 0), 0)
    const waData = { sent: sumWa('sent'), delivered: sumWa('delivered'), read: sumWa('read'), clicks: sumWa('clicked'), sales: sumWa('sales'), revenue: sumWa('revenue'), budget: 0, codeRedemptions: 0, avgCostPerClick: 0 }

    // ── 10. Assemble result ─────────────────────────────────────────────────
    const allClicks = totalClicks + waData.clicks
    const allSales  = totalSales  + waData.sales
    const convRate  = allClicks > 0 ? (allSales / allClicks) * 100 : 0

    const result = {
      summary: {
        totalClicks:       allClicks,
        totalSales:        allSales,
        codeRedemptions:   infCode + seoCode + affCode,
        cookieSales:       sumBy('influencer','cookie_sales') + sumBy('publication','cookie_sales') + sumBy('affiliate','cookie_sales'),
        conversionRate:    Math.round(convRate * 100) / 100,
        revenueAttributed: totalRev + waData.revenue,
        totalBudget,
        avgCostPerClick:   allClicks > 0 && totalBudget > 0 ? Math.round((totalBudget / allClicks) * 100) / 100 : 0,
        avgCostPerSale:    allSales  > 0 && totalBudget > 0 ? Math.round((totalBudget / allSales)  * 100) / 100 : 0,
      },
      channels: {
        influencer: { clicks: infClicks, sales: infSales, revenue: infRev, budget: infFees, codeRedemptions: infCode, avgCostPerClick: infClicks > 0 && infFees > 0 ? Math.round((infFees / infClicks) * 100) / 100 : 0 },
        seo:        { clicks: seoClicks, sales: seoSales, revenue: seoRev, budget: pubCosts, codeRedemptions: seoCode, avgCostPerClick: seoClicks > 0 && pubCosts > 0 ? Math.round((pubCosts / seoClicks) * 100) / 100 : 0 },
        affiliate:  { clicks: affClicks, sales: affSales, revenue: affRev, budget: 0, codeRedemptions: affCode, avgCostPerClick: 0 },
        whatsapp:   waData,
      },
      influencers:  influencerStats,
      publications: publicationStats,
      affiliates:   affiliateStats,
      geoPoints,
      events:       [],   // Raw events no longer returned — use /api/events if needed
    }

    await cacheSet(cKey, result, 120)
    return NextResponse.json(result)

  } catch (err: any) {
    console.error('metrics error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}