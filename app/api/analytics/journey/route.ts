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
    const model    = searchParams.get('model') || 'first_touch' // first_touch | last_touch | linear | time_decay

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    const nextMonth  = new Date(monthStart)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const monthEnd   = nextMonth.toISOString().slice(0, 10)

    // 1. All touchpoints for this month
    const { data: allTouchpoints } = await sb
      .from('journey_touchpoints')
      .select('*')
      .eq('client_id', clientId)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)
      .order('created_at', { ascending: true })

    const tps = allTouchpoints || []

    // 2. Group by visitor_id to build journeys
    const journeyMap: Record<string, any[]> = {}
    tps.forEach(tp => {
      if (!journeyMap[tp.visitor_id]) journeyMap[tp.visitor_id] = []
      journeyMap[tp.visitor_id].push(tp)
    })

    // 3. Build journey paths
    const journeyPaths: Record<string, { count: number; converted: number; dropped: number }> = {}
    const visitorJourneys = Object.values(journeyMap)

    visitorJourneys.forEach(touches => {
      const path = touches.map(t => t.channel).join(' → ')
      if (!journeyPaths[path]) journeyPaths[path] = { count: 0, converted: 0, dropped: 0 }
      journeyPaths[path].count++
      const didConvert = touches.some(t => t.event_type === 'purchase')
      if (didConvert) journeyPaths[path].converted++
      else journeyPaths[path].dropped++
    })

    const topJourneys = Object.entries(journeyPaths)
      .map(([path, stats]) => ({ path, ...stats, convRate: stats.count > 0 ? Math.round((stats.converted / stats.count) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)

    // 4. Sankey nodes and links
    const nodeSet = new Set<string>()
    const linkMap: Record<string, number> = {}

    visitorJourneys.forEach(touches => {
      for (let i = 0; i < touches.length - 1; i++) {
        const from = touches[i].channel
        const to   = touches[i + 1].channel
        const key  = `${from}||${to}`
        nodeSet.add(from)
        nodeSet.add(to)
        linkMap[key] = (linkMap[key] || 0) + 1
      }
      if (touches.length > 0) nodeSet.add(touches[touches.length - 1].channel)
    })

    const sankeyNodes = Array.from(nodeSet).map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }))
    const sankeyLinks = Object.entries(linkMap).map(([key, value]) => {
      const [source, target] = key.split('||')
      return { source, target, value }
    }).sort((a, b) => b.value - a.value)

    // 5. Channel assist matrix (first touch → last touch)
    const channels = ['influencer', 'seo', 'affiliate', 'whatsapp', 'direct', 'organic', 'social', 'email']
    const assistMatrix: Record<string, Record<string, number>> = {}
    channels.forEach(ch => { assistMatrix[ch] = {} })

    visitorJourneys.forEach(touches => {
      if (touches.length < 2) return
      const first = touches[0].channel
      const last  = touches[touches.length - 1].channel
      if (first !== last) {
        if (!assistMatrix[first]) assistMatrix[first] = {}
        assistMatrix[first][last] = (assistMatrix[first][last] || 0) + 1
      }
    })

    // 6. Attribution model calculation
    const partnerRevenue: Record<string, { id: string; name: string; channel: string; revenue: number; assists: number; touches: number }> = {}

    // Get purchases with order values
    const { data: purchaseEvents } = await sb
      .from('events')
      .select('visitor_id, order_value, influencer_id, affiliate_id, publication_id')
      .eq('client_id', clientId)
      .in('type', ['code_sale', 'cookie_sale'])
      .gte('timestamp', monthStart)
      .lt('timestamp', monthEnd)

    const purchases = purchaseEvents || []

    purchases.forEach(p => {
      const orderValue = p.order_value || 0
      const visitorTouches = journeyMap[p.visitor_id] || []
      if (visitorTouches.length === 0) return

      visitorTouches.forEach((touch, idx) => {
        if (!touch.partner_id) return
        if (!partnerRevenue[touch.partner_id]) {
          partnerRevenue[touch.partner_id] = { id: touch.partner_id, name: touch.partner_name || 'Unknown', channel: touch.channel, revenue: 0, assists: 0, touches: 0 }
        }
        partnerRevenue[touch.partner_id].touches++

        let credit = 0
        const n = visitorTouches.length
        if (model === 'first_touch')  credit = idx === 0 ? orderValue : 0
        if (model === 'last_touch')   credit = idx === n - 1 ? orderValue : 0
        if (model === 'linear')       credit = orderValue / n
        if (model === 'time_decay') {
          const weights = visitorTouches.map((_, i) => Math.pow(2, i))
          const totalWeight = weights.reduce((s, w) => s + w, 0)
          credit = orderValue * (weights[idx] / totalWeight)
        }
        partnerRevenue[touch.partner_id].revenue += credit
        if (idx > 0 && idx < n - 1) partnerRevenue[touch.partner_id].assists++
      })
    })

    const attributedRevenue = Object.values(partnerRevenue)
      .sort((a, b) => b.revenue - a.revenue)

    // 7. Multi-touch stats
    const multiTouchJourneys = visitorJourneys.filter(j => j.length > 1).length
    const singleTouchJourneys = visitorJourneys.filter(j => j.length === 1).length
    const avgTouches = visitorJourneys.length > 0
      ? Math.round((visitorJourneys.reduce((s, j) => s + j.length, 0) / visitorJourneys.length) * 10) / 10
      : 0

    return NextResponse.json({
      summary: {
        totalJourneys: visitorJourneys.length,
        multiTouchJourneys,
        singleTouchJourneys,
        multiTouchPct: visitorJourneys.length > 0 ? Math.round((multiTouchJourneys / visitorJourneys.length) * 100) : 0,
        avgTouches,
      },
      topJourneys,
      sankeyNodes,
      sankeyLinks,
      assistMatrix,
      attributedRevenue,
      model,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}