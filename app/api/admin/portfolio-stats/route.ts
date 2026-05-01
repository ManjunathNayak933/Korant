export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()

  const [
    { count: totalClients },
    { count: activeClients },
    { count: totalAgencies },
    { data: planCounts },
    { data: recentEvents },
  ] = await Promise.all([
    sb.from('clients').select('id', { count: 'exact', head: true }),
    sb.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('agencies').select('id', { count: 'exact', head: true }),
    sb.from('clients').select('plan'),
    sb.from('events').select('type, order_value').gte('timestamp', new Date(Date.now() - 30 * 86400000).toISOString()),
  ])

  const basicCount = (planCounts || []).filter(c => c.plan === 'basic').length
  const proCount = (planCounts || []).filter(c => c.plan === 'pro').length

  const clicks = (recentEvents || []).filter(e => e.type === 'click').length
  const sales = (recentEvents || []).filter(e => e.type !== 'click').length
  const revenue = (recentEvents || []).reduce((s, e) => s + (e.order_value || 0), 0)

  const basicPrice = 3001
  const proPrice = 6211
  const mrr = basicCount * basicPrice + proCount * proPrice

  return NextResponse.json({
    mrr,
    totalClients: totalClients || 0,
    activeClients: activeClients || 0,
    totalAgencies: totalAgencies || 0,
    platformClicks: clicks,
    platformSales: sales,
    platformRevenue: revenue,
    basicClients: basicCount,
    proClients: proCount,
  })
}
