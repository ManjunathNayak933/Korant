// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/payouts/generate/route.ts
// │ Replace the existing file at <repo-root>/app/api/payouts/generate/route.ts
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// POST /api/payouts/generate
// Rules:
//   - Current month selected → period is 1st of month to TODAY (inclusive)
//   - Past month selected   → period is 1st to last day of that full month
//   - Future month         → rejected
//   - Regenerating same month → UPSERT, updates with latest figures
export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-user-id')
  const role     = req.headers.get('x-user-role')
  if (!clientId || role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { affiliateId, month } = await req.json()
  if (!affiliateId) return NextResponse.json({ error: 'affiliateId required' }, { status: 400 })

  const today        = new Date()
  // NOTE (IST): currentMonth/periodEnd are derived from UTC `now()`. For an India
  // business this can misclassify the boundary — e.g. at 02:00 IST on Jun 1, UTC
  // is still May 31, so currentMonth reads '...-05' and a payout for June would be
  // rejected as a "future month" for ~5.5h. Aligning this to IST is part of the
  // coordinated timezone change (must move with record_click + metrics windows).
  const currentMonth = today.toISOString().slice(0, 7) // 'YYYY-MM' (UTC)
  const selected     = month || currentMonth           // 'YYYY-MM'

  // ── Reject future months ───────────────────────────────────────────────
  if (selected > currentMonth) {
    return NextResponse.json({ error: `Cannot generate payout for a future month (${selected})` }, { status: 400 })
  }

  const periodStart = `${selected}-01`

  // ── Determine period end ───────────────────────────────────────────────
  let periodEnd: string
  if (selected === currentMonth) {
    // Current month: cover up to and including today
    periodEnd = today.toISOString().slice(0, 10)
  } else {
    // Past month: cover the full month (1st to last day).
    // Deterministic last-day-of-month via UTC. The old
    // `new Date(selected+'-01').setMonth(+1); setDate(0)` mutated in the runtime's
    // LOCAL timezone and was correct only because Cloudflare runs in UTC.
    const [sY, sM] = selected.split('-').map(Number) // sM is 1-based
    // Day 0 of the *next* month = the last day of `selected`.
    periodEnd = new Date(Date.UTC(sY, sM, 0)).toISOString().slice(0, 10)
  }

  const sb = getSupabaseAdmin()

  const { data: affiliate, error: affErr } = await sb
    .from('affiliates')
    .select('id, name, handle, commission_type, commission_value, client_id, created_at')
    .eq('id', affiliateId)
    .eq('client_id', clientId)
    .single()

  if (affErr || !affiliate) return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 })

  // ── Fetch sales in the period ──────────────────────────────────────────
  const { data: events } = await sb
    .from('events')
    .select('type, order_value, commission_amount')
    .eq('affiliate_id', affiliateId)
    .eq('client_id',    clientId)
    .in('type', ['code_sale', 'cookie_sale'])
    .is('reversed_at', null) // exclude refunded / cancelled sales
    .gte('timestamp', periodStart)
    .lte('timestamp', `${periodEnd}T23:59:59.999Z`)

  const salesCount   = events?.length || 0
  const totalRevenue = (events || []).reduce((s, e) => s + (e.order_value || 0), 0)
  const commission   = (events || []).reduce((s, e) => {
    if (e.commission_amount) return s + e.commission_amount
    // Fallback when a sale row has no precomputed commission_amount: mirror the
    // attribution math — flat = fixed value, percentage = order_value * value / 100.
    const v = affiliate.commission_value || 0
    return s + (affiliate.commission_type === 'flat' ? v : (e.order_value || 0) * v / 100)
  }, 0)

  if (salesCount === 0) {
    return NextResponse.json({
      error:        `No sales found for ${selected}${selected === currentMonth ? ` (up to ${periodEnd})` : ''}`,
      affiliate:    affiliate.name,
      periodStart,  periodEnd,
    }, { status: 400 })
  }

  // ── UPSERT — regenerating same month updates the record ───────────────
  // onConflict requires the unique constraint: (client_id, affiliate_id, period_start)
  const { data: payout, error: payErr } = await sb
    .from('payouts')
    .upsert({
      client_id:    clientId,
      affiliate_id: affiliateId,
      period_start: periodStart,
      period_end:   periodEnd,
      sales_count:  salesCount,
      revenue:      totalRevenue,
      amount:       Math.round(commission * 100) / 100,
      status:       'pending',
      generated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,affiliate_id,period_start' })
    .select()
    .single()

  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })

  return NextResponse.json({
    payout,
    summary: {
      affiliate:     affiliate.name,
      month:         selected,
      periodStart,
      periodEnd,
      isFull:        selected !== currentMonth,
      salesCount,
      revenue:       totalRevenue,
      commission:    payout.amount,
      note:          selected === currentMonth
        ? `Covers ${periodStart} to ${periodEnd} (partial month — today)`
        : `Covers full month: ${periodStart} to ${periodEnd}`,
    },
  })
}
