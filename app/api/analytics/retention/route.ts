export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const role     = request.headers.get('x-user-role')!
    const userId   = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
    const month    = searchParams.get('month') || new Date().toISOString().slice(0, 7)

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    const nextMonth  = new Date(monthStart)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const monthEnd   = nextMonth.toISOString().slice(0, 10)

    // 1. Total unique visitors this month
    const { data: allVisitors } = await sb
      .from('visitor_first_touch')
      .select('visitor_id, first_channel, converted, first_seen_at, last_seen_at, total_visits')
      .eq('client_id', clientId)
      .gte('first_seen_at', monthStart)
      .lt('first_seen_at', monthEnd)

    const visitors = allVisitors || []
    const totalUnique = visitors.length
    const totalReturned = visitors.filter(v => v.total_visits > 1).length
    const totalConverted = visitors.filter(v => v.converted).length
    const returnRate = totalUnique > 0 ? (totalReturned / totalUnique) * 100 : 0
    const conversionRate = totalUnique > 0 ? (totalConverted / totalUnique) * 100 : 0

    // 2. Return timeline — how many returned within 7/30/90 days
    const { data: touchpoints } = await sb
      .from('journey_touchpoints')
      .select('visitor_id, days_since_first, channel, event_type, created_at')
      .eq('client_id', clientId)
      .eq('event_type', 'return_visit')
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    const tps = touchpoints || []
    const returnTimeline = {
      day1_7:   tps.filter(t => t.days_since_first >= 1  && t.days_since_first <= 7).length,
      day8_14:  tps.filter(t => t.days_since_first >= 8  && t.days_since_first <= 14).length,
      day15_30: tps.filter(t => t.days_since_first >= 15 && t.days_since_first <= 30).length,
      day31_90: tps.filter(t => t.days_since_first >= 31 && t.days_since_first <= 90).length,
    }

    // 3. Cohort table — by acquisition channel
    const channels = ['influencer', 'seo', 'affiliate', 'whatsapp', 'direct', 'organic', 'social']
    const cohort = channels.map(ch => {
      const chVisitors = visitors.filter(v => v.first_channel === ch)
      const total    = chVisitors.length
      const returned = chVisitors.filter(v => v.total_visits > 1).length
      const converted = chVisitors.filter(v => v.converted).length
      // return within 7d
      const ret7d = chVisitors.filter(v => {
        const daysDiff = (new Date(v.last_seen_at).getTime() - new Date(v.first_seen_at).getTime()) / 86400000
        return v.total_visits > 1 && daysDiff <= 7
      }).length
      const ret30d = chVisitors.filter(v => {
        const daysDiff = (new Date(v.last_seen_at).getTime() - new Date(v.first_seen_at).getTime()) / 86400000
        return v.total_visits > 1 && daysDiff <= 30
      }).length
      return {
        channel:    ch,
        total,
        returned,
        ret7d,
        ret30d,
        converted,
        returnRate:      total > 0 ? Math.round((returned  / total) * 100) : 0,
        conversionRate:  total > 0 ? Math.round((converted / total) * 100) : 0,
      }
    }).filter(c => c.total > 0)

    // 4. Drop-off funnel
    const totalJourneyStarts = totalUnique
    const totalReturns       = tps.length
    const { data: purchases } = await sb
      .from('events')
      .select('visitor_id')
      .eq('client_id', clientId)
      .in('type', ['code_sale', 'cookie_sale'])
      .gte('timestamp', monthStart)
      .lt('timestamp', monthEnd)
    const totalPurchases = new Set((purchases || []).map(p => p.visitor_id)).size

    const funnel = [
      { stage: 'First Visit',   count: totalJourneyStarts, pct: 100 },
      { stage: 'Return Visit',  count: totalReturned,      pct: totalJourneyStarts > 0 ? Math.round((totalReturned / totalJourneyStarts) * 100) : 0 },
      { stage: 'Purchased',     count: totalConverted,     pct: totalJourneyStarts > 0 ? Math.round((totalConverted / totalJourneyStarts) * 100) : 0 },
    ]

    // 5. Return visits grouped by day for timeline chart
    const dailyReturns: Record<string, number> = {}
    tps.forEach(t => {
      const day = t.created_at?.slice(0, 10) || ''
      if (day) dailyReturns[day] = (dailyReturns[day] || 0) + 1
    })
    const dailyReturnChart = Object.entries(dailyReturns)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      summary: { totalUnique, totalReturned, totalConverted, returnRate: Math.round(returnRate * 10) / 10, conversionRate: Math.round(conversionRate * 10) / 10 },
      returnTimeline,
      cohort,
      funnel,
      dailyReturnChart,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}