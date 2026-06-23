// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/affiliate-payout-report/route.ts                   │
// │ Replace the existing file at <repo-root>/app/api/affiliate-payout-report/route.ts │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
  const month = searchParams.get('month')

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  // IST month window (events are timestamptz; bucket by Asia/Kolkata so this report
  // agrees with the dashboard and the payout generator). Half-open [start, end) so
  // the last day isn't dropped. With no month, cover all time.
  let startInstant = '2000-01-01T00:00:00Z'
  let endInstant   = '2099-12-31T00:00:00Z'
  if (month) {
    const [ry, rm]      = month.split('-').map(Number) // rm 1-based
    const nextMonthDate = new Date(Date.UTC(ry, rm, 1)).toISOString().slice(0, 10)
    startInstant = new Date(`${month}-01T00:00:00+05:30`).toISOString()
    endInstant   = new Date(`${nextMonthDate}T00:00:00+05:30`).toISOString()
  }

  const { data: events } = await sb
    .from('events')
    .select('affiliate_id, order_value, commission_amount, timestamp')
    .eq('client_id', clientId)
    .not('affiliate_id', 'is', null)
    .is('reversed_at', null) // exclude refunded / cancelled sales
    .in('type', ['code_sale', 'cookie_sale']) // BUG FIX: count sales only, not clicks
    .gte('timestamp', startInstant)
    .lt('timestamp', endInstant)

  const { data: affiliates } = await sb
    .from('affiliates')
    .select('id, name, handle, email, commission_type, commission_value')
    .eq('client_id', clientId)

  const report = (affiliates || []).map(aff => {
    const affEvents = (events || []).filter(e => e.affiliate_id === aff.id)
    const totalRevenue = affEvents.reduce((s, e) => s + (e.order_value || 0), 0)
    const totalCommission = affEvents.reduce((s, e) => s + (e.commission_amount || 0), 0)
    return {
      affiliate_id: aff.id,
      name: aff.name,
      handle: aff.handle,
      email: aff.email,
      sales: affEvents.length,
      revenue_attributed: totalRevenue,
      commission_due: totalCommission,
      commission_type: aff.commission_type,
      commission_value: aff.commission_value,
    }
  }).filter(a => a.sales > 0)

  return NextResponse.json(report)
}
