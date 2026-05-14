export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// POST /api/payouts/generate
// Generates a payout for an affiliate for the selected calendar month.
// Uses the month picker approach — always covers the full selected month,
// regardless of when the last payout was generated.
export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-user-id')
  const role     = req.headers.get('x-user-role')
  if (!clientId || role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { affiliateId, month } = await req.json()
  if (!affiliateId) return NextResponse.json({ error: 'affiliateId required' }, { status: 400 })

  // month = 'YYYY-MM', defaults to current month
  const selectedMonth = month || new Date().toISOString().slice(0, 7)
  const periodStart   = `${selectedMonth}-01`
  const periodEndDate = new Date(periodStart)
  periodEndDate.setMonth(periodEndDate.getMonth() + 1)
  const periodEnd = periodEndDate.toISOString().slice(0, 10)

  const sb = getSupabaseAdmin()

  // Validate affiliate belongs to this client
  const { data: affiliate, error: affErr } = await sb
    .from('affiliates')
    .select('id, name, handle, commission_rate, client_id, created_at')
    .eq('id', affiliateId)
    .eq('client_id', clientId)
    .single()

  if (affErr || !affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 })

  // Check no payout already exists for this affiliate + month
  const { data: existing } = await sb
    .from('payouts')
    .select('id, status')
    .eq('client_id',    clientId)
    .eq('affiliate_id', affiliateId)
    .eq('period_start', periodStart)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      error:   `A ${existing.status} payout already exists for this affiliate for ${selectedMonth}`,
      existingId: existing.id,
    }, { status: 409 })
  }

  // Fetch all sales events for this affiliate in the selected month
  const { data: events } = await sb
    .from('events')
    .select('type, order_value, commission_amount')
    .eq('affiliate_id', affiliateId)
    .eq('client_id',    clientId)
    .in('type', ['code_sale', 'cookie_sale'])
    .gte('timestamp', periodStart)
    .lt('timestamp',  periodEnd)

  if (!events?.length) {
    return NextResponse.json({
      error:       `No sales found for ${selectedMonth}`,
      periodStart, periodEnd,
      affiliate:   affiliate.name,
    }, { status: 400 })
  }

  const totalRevenue = events.reduce((s, e) => s + (e.order_value || 0), 0)
  const commission   = events.reduce((s, e) => {
    // Use stored commission_amount if present (set at webhook time)
    // otherwise compute from order_value × rate
    if (e.commission_amount) return s + e.commission_amount
    return s + (e.order_value || 0) * ((affiliate.commission_rate || 0) / 100)
  }, 0)

  const { data: payout, error: payErr } = await sb
    .from('payouts')
    .insert({
      client_id:    clientId,
      affiliate_id: affiliateId,
      period_start: periodStart,
      period_end:   periodEnd,
      sales_count:  events.length,
      revenue:      totalRevenue,
      amount:       Math.round(commission * 100) / 100,
      status:       'pending',
      generated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })

  return NextResponse.json({
    payout,
    summary: {
      affiliate:   affiliate.name,
      month:       selectedMonth,
      periodStart, periodEnd,
      salesCount:  events.length,
      revenue:     totalRevenue,
      commission:  payout.amount,
    },
  })
}