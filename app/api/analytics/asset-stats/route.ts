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
    const channel  = searchParams.get('channel') || 'influencer'

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
    if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    const nextMonth  = new Date(monthStart)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const monthEnd   = nextMonth.toISOString().slice(0, 10)

    // 1. Get all touchpoints for this client in this month
    const { data: allTouchpoints } = await sb
      .from('journey_touchpoints')
      .select('visitor_id, partner_id, partner_name, channel, event_type, days_since_first')
      .eq('client_id', clientId)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    const tps = allTouchpoints || []

    // 2. Build a map: visitor_id → Set of all partner_ids they touched (across ALL channels)
    const visitorAllPartners: Record<string, Set<string>> = {}
    tps.forEach(tp => {
      if (!tp.partner_id) return
      if (!visitorAllPartners[tp.visitor_id]) visitorAllPartners[tp.visitor_id] = new Set()
      visitorAllPartners[tp.visitor_id].add(tp.partner_id)
    })

    // 3. Get all touchpoints for THIS channel only
    const channelTps = tps.filter(tp => tp.channel === channel && tp.partner_id)

    // 4. Group by partner_id
    const partnerMap: Record<string, {
      id: string; name: string
      visitors: Set<string>
      returnedVisitors: Set<string>
      sharedVisitors: Set<string>
    }> = {}

    channelTps.forEach(tp => {
      if (!partnerMap[tp.partner_id]) {
        partnerMap[tp.partner_id] = {
          id: tp.partner_id, name: tp.partner_name || 'Unknown',
          visitors: new Set(), returnedVisitors: new Set(), sharedVisitors: new Set(),
        }
      }
      const p = partnerMap[tp.partner_id]
      p.visitors.add(tp.visitor_id)

      // Returned = visitor came back (days_since_first > 0 on a subsequent touch)
      if (tp.days_since_first && tp.days_since_first > 0) {
        p.returnedVisitors.add(tp.visitor_id)
      }

      // Shared = this visitor also touched at least one OTHER partner across any channel
      const allPartners = visitorAllPartners[tp.visitor_id] || new Set()
      const otherPartners = [...allPartners].filter(pid => pid !== tp.partner_id)
      if (otherPartners.length > 0) {
        p.sharedVisitors.add(tp.visitor_id)
      }
    })

    // Check visitor_first_touch for return data — paginated in chunks of 500
    const allVisitorIds = [...new Set(channelTps.map(t => t.visitor_id))]
    const ftMap: Record<string, any> = {}
    if (allVisitorIds.length > 0) {
      const chunkSize = 500
      const chunks: string[][] = []
      for (let i = 0; i < allVisitorIds.length; i += chunkSize) chunks.push(allVisitorIds.slice(i, i + chunkSize))
      const results = await Promise.all(
        chunks.map(chunk =>
          sb.from('visitor_first_touch')
            .select('visitor_id, total_visits, converted')
            .eq('client_id', clientId)
            .in('visitor_id', chunk)
        )
      )
      results.forEach(r => (r.data || []).forEach((ft: any) => { ftMap[ft.visitor_id] = ft }))
    }

    // 6. Build final stats per partner
    const partnerStats = Object.values(partnerMap).map(p => {
      const unique   = p.visitors.size
      const returned = [...p.visitors].filter(vid => {
        const ft = ftMap[vid]
        return ft && ft.total_visits > 1
      }).length
      const shared   = p.sharedVisitors.size
      return {
        id:           p.id,
        name:         p.name,
        unique,
        returned,
        shared,
        returnRate:   unique > 0 ? Math.round((returned / unique) * 100) : 0,
        sharedRate:   unique > 0 ? Math.round((shared   / unique) * 100) : 0,
      }
    })

    // 7. Channel-level totals
    const allChannelVisitors = new Set(channelTps.map(t => t.visitor_id))
    const totalUnique   = allChannelVisitors.size
    const totalReturned = [...allChannelVisitors].filter(vid => {
      const ft = ftMap[vid]; return ft && ft.total_visits > 1
    }).length
    const totalShared = [...allChannelVisitors].filter(vid => {
      const all = visitorAllPartners[vid] || new Set()
      return all.size > 1
    }).length

    return NextResponse.json({
      channel,
      channelSummary: {
        totalUnique,
        totalReturned,
        totalShared,
        returnRate: totalUnique > 0 ? Math.round((totalReturned / totalUnique) * 100) : 0,
        sharedRate: totalUnique > 0 ? Math.round((totalShared   / totalUnique) * 100) : 0,
      },
      partnerStats,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
