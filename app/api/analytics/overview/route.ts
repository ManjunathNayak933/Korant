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
    if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

    // Get conversion data from visitor_first_touch — paginated in chunks of 500
    const allVids = [...new Set(tps.map(t => t.visitor_id))]
    const ftMap: Record<string, any> = {}
    if (allVids.length > 0) {
      const chunkSize = 500
      const chunks: string[][] = []
      for (let i = 0; i < allVids.length; i += chunkSize) chunks.push(allVids.slice(i, i + chunkSize))
      const results = await Promise.all(
        chunks.map(chunk =>
          sb.from('visitor_first_touch')
            .select('visitor_id, converted, total_visits')
            .eq('client_id', clientId)
            .in('visitor_id', chunk)
        )
      )
      results.forEach(r => (r.data || []).forEach((ft: any) => { ftMap[ft.visitor_id] = ft }))
    }

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

    // Audience overlap — pair-counting from visitorAllPartners (O(visitors), not O(partners²×visitors))
    const pairOverlap: Record<string, number> = {}
    Object.values(visitorAllPartners).forEach(partnerSet => {
      const pids = [...partnerSet].filter(pid => partnerMap[pid])
      for (let i = 0; i < pids.length; i++) {
        for (let j = i + 1; j < pids.length; j++) {
          const key = pids[i] < pids[j] ? `${pids[i]}||${pids[j]}` : `${pids[j]}||${pids[i]}`
          pairOverlap[key] = (pairOverlap[key] || 0) + 1
        }
      }
    })
    const overlapPairs = Object.entries(pairOverlap)
      .map(([key, overlap]) => {
        const [aId, bId] = key.split('||')
        const pa = partnerMap[aId], pb = partnerMap[bId]
        if (!pa || !pb) return null
        return {
          nameA: pa.name, channelA: pa.channel,
          nameB: pb.name, channelB: pb.channel,
          overlap,
          overlapPct: Math.round(overlap / Math.min(pa.visitors.size, pb.visitors.size) * 100),
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.overlap - a.overlap)
      .slice(0, 20)

    // Universe stats
    const totalUniverse    = new Set(tps.map(t => t.visitor_id)).size
    const totalMultiTouch  = Object.values(visitorAllPartners).filter(s => s.size > 1).length
    const totalSingleTouch = totalUniverse - totalMultiTouch

    return NextResponse.json({
      universe: { totalUniverse, totalMultiTouch, totalSingleTouch },
      scatterData,
      overlapPairs,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
