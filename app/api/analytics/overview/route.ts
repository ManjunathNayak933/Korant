export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const role   = request.headers.get('x-user-role')!
    const userId = request.headers.get('x-user-id')!
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
    const month    = searchParams.get('month') || new Date().toISOString().slice(0, 7)

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    const nextMonth  = new Date(monthStart)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const monthEnd   = nextMonth.toISOString().slice(0, 10)

    // All touchpoints this month
    const { data: allTps } = await sb
      .from('journey_touchpoints')
      .select('visitor_id, partner_id, partner_name, channel, event_type, days_since_first')
      .eq('client_id', clientId)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    const tps = allTps || []

    // visitor → all partners map
    const visitorAllPartners: Record<string, Set<string>> = {}
    tps.forEach(tp => {
      if (!tp.partner_id) return
      if (!visitorAllPartners[tp.visitor_id]) visitorAllPartners[tp.visitor_id] = new Set()
      visitorAllPartners[tp.visitor_id].add(tp.partner_id)
    })

    // Build per-partner stats across all channels for scatter plot
    const partnerMap: Record<string, {
      id: string; name: string; channel: string
      visitors: Set<string>; conversions: number
    }> = {}

    tps.forEach(tp => {
      if (!tp.partner_id) return
      if (!partnerMap[tp.partner_id]) {
        partnerMap[tp.partner_id] = { id: tp.partner_id, name: tp.partner_name || 'Unknown', channel: tp.channel, visitors: new Set(), conversions: 0 }
      }
      partnerMap[tp.partner_id].visitors.add(tp.visitor_id)
      if (tp.event_type === 'purchase') partnerMap[tp.partner_id].conversions++
    })

    // Get conversion data from visitor_first_touch
    const allVids = [...new Set(tps.map(t => t.visitor_id))]
    const { data: ftData } = allVids.length > 0
      ? await sb.from('visitor_first_touch').select('visitor_id, converted, total_visits').eq('client_id', clientId).in('visitor_id', allVids.slice(0, 500))
      : { data: [] }
    const ftMap: Record<string, any> = {}
    ;(ftData || []).forEach(ft => { ftMap[ft.visitor_id] = ft })

    // Scatter data — all partners across all channels
    const scatterData = Object.values(partnerMap).map(p => {
      const unique = p.visitors.size
      const converted = [...p.visitors].filter(vid => ftMap[vid]?.converted).length
      const returned  = [...p.visitors].filter(vid => ftMap[vid]?.total_visits > 1).length
      const shared    = [...p.visitors].filter(vid => (visitorAllPartners[vid]?.size || 0) > 1).length
      const freshnessRate = unique > 0 ? Math.round((unique - shared) / unique * 100) : 0
      return {
        id:             p.id,
        name:           p.name,
        channel:        p.channel,
        unique,
        converted,
        returned,
        shared,
        freshnessRate,
        conversionRate: unique > 0 ? Math.round((converted / unique) * 100) : 0,
        returnRate:     unique > 0 ? Math.round((returned  / unique) * 100) : 0,
      }
    }).filter(p => p.unique > 0).sort((a, b) => b.unique - a.unique)

    // Audience overlap — top partner pairs with shared visitors (Option B: cross-channel)
    const partnerIds = Object.keys(partnerMap).slice(0, 15)
    const overlapPairs: {
      partnerA: string; nameA: string; channelA: string
      partnerB: string; nameB: string; channelB: string
      overlap: number; overlapPct: number
    }[] = []

    for (let i = 0; i < partnerIds.length; i++) {
      for (let j = i + 1; j < partnerIds.length; j++) {
        const aVis = partnerMap[partnerIds[i]]?.visitors || new Set()
        const bVis = partnerMap[partnerIds[j]]?.visitors || new Set()
        const overlap = [...aVis].filter(v => bVis.has(v)).length
        if (overlap > 0) {
          overlapPairs.push({
            partnerA:   partnerIds[i],
            nameA:      partnerMap[partnerIds[i]]?.name || '',
            channelA:   partnerMap[partnerIds[i]]?.channel || '',
            partnerB:   partnerIds[j],
            nameB:      partnerMap[partnerIds[j]]?.name || '',
            channelB:   partnerMap[partnerIds[j]]?.channel || '',
            overlap,
            overlapPct: Math.round(overlap / Math.min(aVis.size, bVis.size) * 100),
          })
        }
      }
    }
    overlapPairs.sort((a, b) => b.overlap - a.overlap)

    // Universe stats
    const totalUniverse    = new Set(tps.map(t => t.visitor_id)).size
    const totalMultiTouch  = Object.values(visitorAllPartners).filter(s => s.size > 1).length
    const totalSingleTouch = totalUniverse - totalMultiTouch

    return NextResponse.json({
      universe: { totalUniverse, totalMultiTouch, totalSingleTouch },
      scatterData,
      overlapPairs: overlapPairs.slice(0, 20),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}