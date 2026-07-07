// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/analytics/funnel/route.ts                         │
// │ NEW FILE — create at <repo-root>/app/api/analytics/funnel/route.ts   │
// └──────────────────────────────────────────────────────────────────────┘
//
// Campaign-wise conversion funnel for the Overview tab.
//
//   Clicks  →  Store visitors  →  Engaged  →  Purchased
//
// Two design facts drive the query, both learned from the tracking pipeline:
//
//  1. Only 'click' touchpoints carry campaign_id. They're written by the
//     record_click RPC in /r/[slug]. The beacon's return_visit and purchase
//     touchpoints do NOT carry campaign_id (see lib/event-queue.ts →
//     writeEventDirect / recordTouchpoint). So we can only slice by campaign at
//     the click stage — and we anchor the whole funnel on that click set, then
//     look up each of those visitors' overall journey outcome.
//
//  2. This is deliberately ALL CHANNELS combined (influencer + seo + affiliate
//     + whatsapp + direct). We filter by event_type + campaign only, never by
//     channel, so every channel that produced a click is in the funnel.
//
// Because every stage is derived from the SAME cohort of visitors, the funnel
// is a strict subset at each step (clicks ≥ visitors ≥ engaged ≥ purchased) and
// can never visually invert.

export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const role     = request.headers.get('x-user-role')!
    const userId   = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)
    const clientId   = searchParams.get('clientId') || (role === 'client' ? userId : null)
    const month      = searchParams.get('month') || new Date().toISOString().slice(0, 7)
    // No campaignId → "All" (overall, every campaign). A campaignId → that campaign only.
    const campaignId = searchParams.get('campaignId') || null

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
    if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    const nextMonth  = new Date(monthStart)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const monthEnd   = nextMonth.toISOString().slice(0, 10)

    // ── Stage 1: CLICKS ──────────────────────────────────────────────────────
    // The anchor set. Filtered by campaign when one is selected; spans every
    // channel otherwise. Row count = total link opens; distinct visitor_id =
    // unique reach.
    let clickQuery = sb
      .from('journey_touchpoints')
      .select('visitor_id')
      .eq('client_id', clientId)
      .eq('event_type', 'click')
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)
    if (campaignId) clickQuery = clickQuery.eq('campaign_id', campaignId)

    const { data: clicks } = await clickQuery
    const clickRows   = clicks || []
    const totalClicks = clickRows.length
    const visitorIds  = [...new Set(clickRows.map((c: any) => c.visitor_id))]
    const reach       = visitorIds.length

    // ── Stages 3 & 4: ENGAGED + PURCHASED ────────────────────────────────────
    // Pulled from each clicker's overall outcome in visitor_first_touch, so the
    // cohort stays fixed across stages. Chunked by 500 (Supabase .in cap), same
    // pattern as /api/analytics/overview.
    let engaged   = 0
    let purchased = 0
    if (visitorIds.length > 0) {
      const chunkSize = 500
      const chunks: string[][] = []
      for (let i = 0; i < visitorIds.length; i += chunkSize) chunks.push(visitorIds.slice(i, i + chunkSize))

      const results = await Promise.all(
        chunks.map(chunk =>
          sb.from('visitor_first_touch')
            .select('visitor_id, converted, total_visits')
            .eq('client_id', clientId)
            .in('visitor_id', chunk)
        )
      )

      results.forEach(r => (r.data || []).forEach((ft: any) => {
        const didConvert = !!ft.converted
        // "Engaged" = the beacon fired at least once after the click (they
        // actually landed and browsed the store), OR they converted. The OR
        // guarantees every purchaser is also counted as engaged, keeping the
        // funnel monotonic even in rare write-ordering edge cases.
        const didEngage = (ft.total_visits || 1) > 1 || didConvert
        if (didEngage)   engaged++
        if (didConvert)  purchased++
      }))
    }

    const stages = [
      { key: 'clicks',    label: 'Clicks',         count: totalClicks },
      { key: 'reach',     label: 'Store visitors', count: reach },
      { key: 'engaged',   label: 'Engaged',        count: engaged },
      { key: 'purchased', label: 'Purchased',      count: purchased },
    ]

    return NextResponse.json({
      scope: { month, campaignId, channel: 'all' },
      stages,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
