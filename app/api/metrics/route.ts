export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { cacheGet, cacheSet, metricsKey } from '@/lib/cache'

interface PartnerRow {
  partner_id: string; partner_type: 'influencer' | 'publication' | 'affiliate'
  clicks: number; sales: number; code_sales: number; cookie_sales: number
  revenue: number; commission: number; campaign_id: string | null
}

export async function GET(request: NextRequest) {
  try {
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

    if (role === 'agency') {
      const sb0 = getSupabaseAdmin()
      const { data: rel } = await sb0
        .from('agency_handlers').select('client_id')
        .eq('agency_id', userId).eq('client_id', clientId).maybeSingle()
      if (!rel) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const cKey = metricsKey(clientId, month, campaignId)
    if (!noCache) {
      const cached = await cacheGet(cKey)
      if (cached) return NextResponse.json(cached)
    }

    const sb = getSupabaseAdmin()

    const nm = new Date(month + '-01')
    nm.setMonth(nm.getMonth() + 1)
    const nextMonthStr = nm.toISOString().slice(0, 10)

    // ── 1. Pre-aggregated partner stats ────────────────────────────────────
    let statsQuery = sb
      .from('partner_stats_monthly')
      .select('partner_id, partner_type, campaign_id, clicks, sales, code_sales, cookie_sales, revenue, commission')
      .eq('client_id', clientId)
      .eq('month', month)
    if (campaignId) statsQuery = statsQuery.eq('campaign_id', campaignId)

    // ── 2. Partner metadata ─────────────────────────────────────────────────
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
      // For influencers, filter via junction table (influencer_campaigns) so that
      // influencers assigned to a campaign via the new many-to-many flow are included,
      // not just those with campaign_id set directly on the row.
      const { data: junctionIds } = await sb
        .from('influencer_campaigns')
        .select('influencer_id')
        .eq('campaign_id', campaignId)
      const junctionInfluencerIds = (junctionIds || []).map((j: any) => j.influencer_id)

      // Also include influencers still using the legacy campaign_id column
      const { data: legacyInfs } = await sb
        .from('influencers')
        .select('id')
        .eq('client_id', clientId)
        .eq('campaign_id', campaignId)
      const legacyIds = (legacyInfs || []).map((i: any) => i.id)

      // Union both sets, deduplicated
      const allInfluencerIds = [...new Set([...junctionInfluencerIds, ...legacyIds])]

      if (allInfluencerIds.length > 0) {
        infQuery = infQuery.in('id', allInfluencerIds)
      } else {
        // No influencers in this campaign at all — return empty for infQuery
        infQuery = infQuery.eq('id', '00000000-0000-0000-0000-000000000000')
      }

      pubQuery = pubQuery.eq('campaign_id', campaignId)
      try { affQuery = (affQuery as any).eq('campaign_id', campaignId) } catch { /* skip */ }
    }

    // ── 3. WhatsApp ─────────────────────────────────────────────────────────
    let waQuery = sb.from('whatsapp_campaigns')
      .select('sent, delivered, read, clicked, sales, revenue')
      .eq('client_id', clientId).eq('status', 'sent')
    if (campaignId) waQuery = waQuery.eq('campaign_id', campaignId)

    // ── 4. Geo — async IIFE so a missing RPC doesn't crash the route ────────
    const geoPointsPromise = (async (): Promise<{ city: string; country: string; lat: number; lon: number; clicks: number }[]> => {
      try {
        const r = await sb.rpc('get_click_geo_monthly', {
          p_client_id:   clientId,
          p_month_start: `${month}-01`,
          p_month_end:   nextMonthStr,
        })
        return (r.data || []) as any[]
      } catch {
        return []
      }
    })()

    // Fire queries in parallel
    const [statsRes, infRes, pubRes, affRes, waRes, geoPoints] = await Promise.all([
      statsQuery, infQuery, pubQuery, affQuery, waQuery, geoPointsPromise,
    ])

    const rawStats: PartnerRow[] = (statsRes.data || []).map((r: any) => ({
      ...r,
      // Postgres numeric columns may return as strings — coerce to numbers
      clicks:      Number(r.clicks)      || 0,
      sales:       Number(r.sales)       || 0,
      code_sales:  Number(r.code_sales)  || 0,
      cookie_sales:Number(r.cookie_sales)|| 0,
      revenue:     Number(r.revenue)     || 0,
      commission:  Number(r.commission)  || 0,
    }))

    // ── BUG FIX: Deduplicate by partner_id ──────────────────────────────────
    // Without a campaign filter, partner_stats_monthly returns one row per
    // (partner × campaign). Aggregate them so each partner appears once.
    const dedupMap: Record<string, PartnerRow> = {}
    for (const row of rawStats) {
      if (!dedupMap[row.partner_id]) {
        dedupMap[row.partner_id] = { ...row }
      } else {
        dedupMap[row.partner_id].clicks       += row.clicks
        dedupMap[row.partner_id].sales        += row.sales
        dedupMap[row.partner_id].code_sales   += row.code_sales
        dedupMap[row.partner_id].cookie_sales += row.cookie_sales
        dedupMap[row.partner_id].revenue      += row.revenue
        dedupMap[row.partner_id].commission   += row.commission
      }
    }
    const partnerStats = Object.values(dedupMap)

    const influencers  = infRes.data  || []
    const publications = pubRes.data  || []
    const affiliates   = affRes.data  || []
    const waCampaigns  = waRes.data   || []

    // ── 5. Budget ────────────────────────────────────────────────────────────
    const infFees  = influencers .filter((i: any) => i.created_at >= `${month}-01` && i.created_at < nextMonthStr).reduce((s: number, i: any) => s + (Number(i.fee)  || 0), 0)
    const pubCosts = publications.filter((p: any) => p.created_at >= `${month}-01` && p.created_at < nextMonthStr).reduce((s: number, p: any) => s + (Number(p.cost) || 0), 0)
    const totalBudget = infFees + pubCosts

    // ── 6. Metadata lookup maps ──────────────────────────────────────────────
    const infMeta: Record<string, any> = {}
    const pubMeta: Record<string, any> = {}
    const affMeta: Record<string, any> = {}
    influencers .forEach((i: any) => { infMeta[i.id] = i })
    publications.forEach((p: any) => { pubMeta[p.id] = p })
    affiliates  .forEach((a: any) => { affMeta[a.id] = a })

    // ── 7. Per-partner stats arrays (deduplicated) ───────────────────────────
    // Also fetch last click timestamp per influencer for inactive detection
    const { data: lastClicks } = await sb
      .from('events')
      .select('influencer_id, timestamp')
      .eq('client_id', clientId)
      .eq('type', 'click')
      .not('influencer_id', 'is', null)
      .order('timestamp', { ascending: false })

    // Build map: influencer_id -> most recent click timestamp
    const lastClickMap: Record<string, string> = {}
    for (const e of lastClicks || []) {
      if (e.influencer_id && !lastClickMap[e.influencer_id]) {
        lastClickMap[e.influencer_id] = e.timestamp
      }
    }

    const influencerStats = partnerStats
      .filter(p => p.partner_type === 'influencer' && infMeta[p.partner_id])
      .map(p => {
        const m = infMeta[p.partner_id]
        return {
          influencerId:     p.partner_id,
          name:             m.name,
          handle:           m.handle,
          fee:              m.fee,
          redirect_slug:    m.redirect_slug,
          discount_code:    m.discount_code,
          social_platform:  m.social_platform,
          is_active:        m.is_active,
          clicks:           p.clicks,
          codeRedemptions:  p.code_sales,
          cookieSales:      p.cookie_sales,
          totalSales:       p.sales,
          revenueAttributed:p.revenue,
          conversionRate:   p.clicks > 0 ? (p.sales / p.clicks) * 100 : 0,
          avgCostPerClick:  p.clicks > 0 && m.fee > 0 ? m.fee / p.clicks : 0,
          lastClickAt:      lastClickMap[p.partner_id] || null,
          topCity:          null,
          topReferrer:      null,
          deviceBreakdown:  null,
        }
      })

    const publicationStats = partnerStats
      .filter(p => p.partner_type === 'publication' && pubMeta[p.partner_id])
      .map(p => {
        const m = pubMeta[p.partner_id]
        return {
          publicationId:  p.partner_id,
          name:           m.publication_name,
          cost:           m.cost,
          redirect_slug:  m.redirect_slug,
          is_active:      m.is_active,
          clicks:         p.clicks,
          sales:          p.sales,
          revenue:        p.revenue,
          codeRedemptions:p.code_sales,
          conversionRate: p.clicks > 0 ? (p.sales / p.clicks) * 100 : 0,
          costPerClick:   p.clicks > 0 && m.cost > 0 ? m.cost / p.clicks : 0,
        }
      })

    const affiliateStats = partnerStats
      .filter(p => p.partner_type === 'affiliate' && affMeta[p.partner_id])
      .map(p => {
        const m = affMeta[p.partner_id]
        return {
          affiliateId:     p.partner_id,
          name:            m.name,
          handle:          m.handle,
          clicks:          p.clicks,
          sales:           p.sales,
          revenue:         p.revenue,
          commission:      p.commission,
          codeRedemptions: p.code_sales,
          cookieSales:     p.cookie_sales,
          conversionRate:  p.clicks > 0 ? (p.sales / p.clicks) * 100 : 0,
        }
      })

    // ── 8. Channel totals (from deduplicated stats) ──────────────────────────
    const sumBy = (type: string, field: keyof PartnerRow) =>
      partnerStats.filter(p => p.partner_type === type).reduce((s, p) => s + (p[field] as number || 0), 0)

    const infClicks = sumBy('influencer', 'clicks'); const infSales = sumBy('influencer', 'sales'); const infRev = sumBy('influencer', 'revenue'); const infCode = sumBy('influencer', 'code_sales')
    const seoClicks = sumBy('publication','clicks'); const seoSales = sumBy('publication','sales'); const seoRev = sumBy('publication','revenue'); const seoCode = sumBy('publication','code_sales')
    const affClicks = sumBy('affiliate',  'clicks'); const affSales = sumBy('affiliate', 'sales');  const affRev = sumBy('affiliate', 'revenue');  const affCode = sumBy('affiliate', 'code_sales')

    const totalClicks = infClicks + seoClicks + affClicks
    const totalSales  = infSales  + seoSales  + affSales
    const totalRev    = infRev    + seoRev    + affRev

    // ── 9. WhatsApp ──────────────────────────────────────────────────────────
    const sumWa = (k: string) => waCampaigns.reduce((s: number, w: any) => s + (Number(w[k]) || 0), 0)
    const waData = { sent: sumWa('sent'), delivered: sumWa('delivered'), read: sumWa('read'), clicks: sumWa('clicked'), sales: sumWa('sales'), revenue: sumWa('revenue'), budget: 0, codeRedemptions: 0, avgCostPerClick: 0 }

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
      events: [],
    }

    await cacheSet(cKey, result, 120)
    return NextResponse.json(result)

  } catch (err: any) {
    console.error('metrics error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
