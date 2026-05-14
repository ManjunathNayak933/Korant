export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-user-id')
  const role     = req.headers.get('x-user-role')
  if (!clientId || role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { affiliateId } = await req.json()
  if (!affiliateId) return NextResponse.json({ error: 'affiliateId required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // ── 1. Get affiliate details ───────────────────────────────────────────────
  const { data: affiliate, error: affErr } = await sb
    .from('affiliates')
    .select('id, name, handle, commission_rate, client_id, created_at')
    .eq('id', affiliateId)
    .eq('client_id', clientId)
    .single()

  if (affErr || !affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 })

  // ── 2. Find the period start — date of last payout (or affiliate join date) ─
  // This means: generate payout for EXACTLY the days elapsed since last payout.
  // If you generate today and again after 55 days → covers those 55 days.
  // NOT a fixed 30-day window.
  const { data: lastPayout } = await sb
    .from('payouts')
    .select('period_end, amount')
    .eq('client_id',    clientId)
    .eq('affiliate_id', affiliateId)
    .eq('status', 'paid')  // only count paid payouts, not pending ones
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  const periodStart = lastPayout?.period_end
    ? new Date(lastPayout.period_end)
    : new Date(affiliate.created_at)
  const periodEnd = new Date()

  if (periodStart >= periodEnd) {
    return NextResponse.json({ error: 'No new period to generate — last payout was today' }, { status: 400 })
  }

  const daysCovered = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000)

  // ── 3. Fetch events in the period ─────────────────────────────────────────
  const { data: events } = await sb
    .from('events')
    .select('type, order_value, commission_amount')
    .eq('affiliate_id', affiliateId)
    .eq('client_id',    clientId)
    .in('type', ['code_sale', 'cookie_sale'])
    .gte('timestamp', periodStart.toISOString())
    .lt('timestamp',  periodEnd.toISOString())

  if (!events?.length) {
    return NextResponse.json({
      error:       'No sales in this period',
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd:   periodEnd.toISOString().slice(0, 10),
      daysCovered,
    }, { status: 400 })
  }

  // ── 4. Calculate payout amount ─────────────────────────────────────────────
  // Use stored commission_amount if present (set at order time).
  // Fall back to computing from order_value × commission_rate.
  const totalRevenue = events.reduce((s, e) => s + (e.order_value || 0), 0)
  const commission   = events.reduce((s, e) => {
    if (e.commission_amount) return s + e.commission_amount
    return s + (e.order_value || 0) * ((affiliate.commission_rate || 0) / 100)
  }, 0)

  // ── 5. Create payout record ────────────────────────────────────────────────
  const { data: payout, error: payErr } = await sb
    .from('payouts')
    .insert({
      client_id:    clientId,
      affiliate_id: affiliateId,
      period_start: periodStart.toISOString().slice(0, 10),
      period_end:   periodEnd.toISOString().slice(0, 10),
      days_covered: daysCovered,
      sales_count:  events.length,
      revenue:      totalRevenue,
      amount:       Math.round(commission * 100) / 100, // rounded to 2 decimal places
      status:       'pending',
      generated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })

  return NextResponse.json({
    payout,
    summary: {
      affiliate:    affiliate.name,
      periodStart:  periodStart.toISOString().slice(0, 10),
      periodEnd:    periodEnd.toISOString().slice(0, 10),
      daysCovered,
      salesCount:   events.length,
      revenue:      totalRevenue,
      commission:   payout.amount,
    },
  })
}