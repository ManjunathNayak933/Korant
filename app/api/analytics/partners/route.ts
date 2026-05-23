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
    const channel    = searchParams.get('channel') || 'influencer' // influencer | seo | affiliate

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
    if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    const nextMonth  = new Date(monthStart)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const monthEnd   = nextMonth.toISOString().slice(0, 10)

    // Get all touchpoints for this channel in this month
    const { data: allTouchpoints } = await sb
      .from('journey_touchpoints')
      .select('*')
      .eq('client_id', clientId)
      .eq('channel', channel)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    const tps = allTouchpoints || []

    // Group by partner
    const partnerMap: Record<string, { id: string; name: string; visitors: Set<string>; touches: number; conversions: number }> = {}
    tps.forEach(tp => {
      if (!tp.partner_id) return
      if (!partnerMap[tp.partner_id]) {
        partnerMap[tp.partner_id] = { id: tp.partner_id, name: tp.partner_name || 'Unknown', visitors: new Set(), touches: 0, conversions: 0 }
      }
      partnerMap[tp.partner_id].visitors.add(tp.visitor_id)
      partnerMap[tp.partner_id].touches++
      if (tp.event_type === 'purchase') partnerMap[tp.partner_id].conversions++
    })

    // Get visitor first-touch data for freshness calculation
    const allVisitorIds = [...new Set(tps.map(t => t.visitor_id))]
    const { data: firstTouches } = await sb
      .from('visitor_first_touch')
      .select('visitor_id, first_channel, converted, total_visits')
      .eq('client_id', clientId)
      .in('visitor_id', allVisitorIds.slice(0, 500)) // limit

    const ftMap: Record<string, any> = {}
    ;(firstTouches || []).forEach(ft => { ftMap[ft.visitor_id] = ft })

    // Build per-partner stats
    const partnerStats = Object.values(partnerMap).map(p => {
      const visitorArr = Array.from(p.visitors)
      const totalUnique = visitorArr.length

      // Freshness — visitors whose first_channel was this partner's channel
      const newVisitors = visitorArr.filter(vid => {
        const ft = ftMap[vid]
        return !ft || ft.first_channel === channel
      }).length

      // Audience overlap potential — visitors who also touched other partners
      const multiPartnerVisitors = visitorArr.filter(vid => {
        return tps.some(tp => tp.visitor_id === vid && tp.partner_id !== p.id)
      }).length

      // Return visitors — came back after first touch
      const returnVisitors = visitorArr.filter(vid => {
        const ft = ftMap[vid]
        return ft && ft.total_visits > 1
      }).length

      // Converted
      const convertedVisitors = visitorArr.filter(vid => {
        const ft = ftMap[vid]
        return ft && ft.converted
      }).length

      // Average days to return
      const returningTouches = tps.filter(tp => tp.partner_id === p.id && tp.days_since_first > 0)
      const avgDaysToReturn = returningTouches.length > 0
        ? Math.round(returningTouches.reduce((s, t) => s + (t.days_since_first || 0), 0) / returningTouches.length)
        : null

      return {
        id:           p.id,
        name:         p.name,
        totalUnique,
        newVisitors,
        returnVisitors,
        convertedVisitors,
        multiPartnerVisitors,
        freshnessRate:   totalUnique > 0 ? Math.round((newVisitors / totalUnique) * 100) : 0,
        returnRate:      totalUnique > 0 ? Math.round((returnVisitors / totalUnique) * 100) : 0,
        conversionRate:  totalUnique > 0 ? Math.round((convertedVisitors / totalUnique) * 100) : 0,
        overlapRate:     totalUnique > 0 ? Math.round((multiPartnerVisitors / totalUnique) * 100) : 0,
        avgDaysToReturn,
        reachabilityScore: Math.round(
          (Math.min(totalUnique, 100) / 100) * 30 +
          (newVisitors / Math.max(totalUnique, 1)) * 40 +
          (convertedVisitors / Math.max(totalUnique, 1)) * 30
        ),
      }
    }).sort((a, b) => b.totalUnique - a.totalUnique)

    // Partner overlap matrix
    const partnerIds = partnerStats.map(p => p.id).slice(0, 10)
    const overlapMatrix: { partnerA: string; nameA: string; partnerB: string; nameB: string; overlap: number; overlapPct: number }[] = []

    for (let i = 0; i < partnerIds.length; i++) {
      for (let j = i + 1; j < partnerIds.length; j++) {
        const aVisitors = partnerMap[partnerIds[i]]?.visitors || new Set()
        const bVisitors = partnerMap[partnerIds[j]]?.visitors || new Set()
        const overlap = [...aVisitors].filter(v => bVisitors.has(v)).length
        if (overlap > 0) {
          overlapMatrix.push({
            partnerA:   partnerIds[i],
            nameA:      partnerMap[partnerIds[i]]?.name || '',
            partnerB:   partnerIds[j],
            nameB:      partnerMap[partnerIds[j]]?.name || '',
            overlap,
            overlapPct: Math.round((overlap / Math.min(aVisitors.size, bVisitors.size)) * 100),
          })
        }
      }
    }

    overlapMatrix.sort((a, b) => b.overlap - a.overlap)

    return NextResponse.json({ partnerStats, overlapMatrix, channel })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
