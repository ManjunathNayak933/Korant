// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/payouts/generate/route.ts                              │
// │                                                                            │
// │ POST /api/payouts/generate                                                 │
// │ Rules:                                                                     │
// │   - Current month selected → period is 1st of month to TODAY (inclusive)   │
// │   - Past month selected   → period is 1st to last day of that full month   │
// │   - Future month          → rejected                                       │
// │   - Regenerating same month → UPSERT, updates with latest figures          │
// │                                                                            │
// │ BUG FIX (over-payment): the commission fallback fired on ANY falsy         │
// │ commission_amount — including a deliberate 0 — and recomputed from         │
// │ commission_value WITHOUT checking commission_trigger (which the query      │
// │ didn't even select). attributeSale() writes 0 on purpose when the trigger  │
// │ is 'none' or 'per_lead'; the payout then paid a percentage anyway. Real    │
// │ money out the door. The trigger is now selected and respected, and the     │
// │ fallback only applies to rows where commission_amount is genuinely absent  │
// │ (null/undefined), not zero.                                                │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-user-id')
  const role     = req.headers.get('x-user-role')
  if (!clientId || role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { affiliateId, influencerId, month, includeFee } = body
  if (!affiliateId && !influencerId) return NextResponse.json({ error: 'affiliateId or influencerId required' }, { status: 400 })
  if (affiliateId && influencerId)   return NextResponse.json({ error: 'Pass only one of affiliateId / influencerId' }, { status: 400 })
  const isInfluencer = !!influencerId
  const partnerId    = (influencerId || affiliateId) as string

  if (month && !/^\d{4}-\d{2}$/.test(String(month))) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  // Work in IST (Asia/Kolkata) so a payout "for June" covers the Indian calendar
  // month and matches how clicks/sales are bucketed in the DB. formatToParts is
  // locale-proof and gives zero-padded parts.
  const istNow   = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const istGet   = (t: string) => istNow.find(p => p.type === t)!.value
  const todayIST     = `${istGet('year')}-${istGet('month')}-${istGet('day')}` // 'YYYY-MM-DD' (IST)
  const currentMonth = todayIST.slice(0, 7)                                     // 'YYYY-MM'  (IST)
  const selected     = month || currentMonth                                    // 'YYYY-MM'

  // ── Reject future months ───────────────────────────────────────────────
  if (selected > currentMonth) {
    return NextResponse.json({ error: `Cannot generate payout for a future month (${selected})` }, { status: 400 })
  }

  const periodStart = `${selected}-01` // IST calendar date, stored for display

  // ── Determine period end (IST calendar date, stored for display) ────────
  let periodEnd: string
  if (selected === currentMonth) {
    periodEnd = todayIST // up to & including today (IST)
  } else {
    // Last day of the selected month (pure calendar math, tz-independent).
    const [sY, sM] = selected.split('-').map(Number) // sM is 1-based
    periodEnd = new Date(Date.UTC(sY, sM, 0)).toISOString().slice(0, 10)
  }

  // Absolute-instant bounds for the timestamptz query: from IST 00:00 on
  // periodStart up to (but not including) IST 00:00 on the day after periodEnd.
  const startInstant = new Date(`${periodStart}T00:00:00+05:30`).toISOString()
  const endExclusive = new Date(`${periodEnd}T00:00:00+05:30`)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1) // next IST midnight after periodEnd
  const endInstant   = endExclusive.toISOString()

  const sb = getSupabaseAdmin()

  // Static selects per branch. The old code concatenated the column list
  // (`'...' + (isInfluencer ? ', fee' : '')`), which Supabase's type parser
  // can't read — every field access on the result was typed GenericStringError.
  interface PartnerRow {
    id: string
    name: string
    handle: string | null
    commission_type: string | null
    commission_value: number | null
    commission_trigger: string | null
    client_id: string
    created_at: string
    fee?: number | null
  }

  let partner: PartnerRow | null = null
  if (isInfluencer) {
    const { data } = await sb
      .from('influencers')
      .select('id, name, handle, commission_type, commission_value, commission_trigger, client_id, created_at, fee')
      .eq('id', partnerId).eq('client_id', clientId).maybeSingle()
    partner = (data as PartnerRow) || null
  } else {
    const { data } = await sb
      .from('affiliates')
      .select('id, name, handle, commission_type, commission_value, commission_trigger, client_id, created_at')
      .eq('id', partnerId).eq('client_id', clientId).maybeSingle()
    partner = (data as PartnerRow) || null
  }

  if (!partner) return NextResponse.json({ error: `${isInfluencer ? 'Influencer' : 'Affiliate'} not found` }, { status: 404 })

  // ── Fetch sales in the period ──────────────────────────────────────────
  const { data: events } = await sb
    .from('events')
    .select('type, order_value, commission_amount')
    .eq(isInfluencer ? 'influencer_id' : 'affiliate_id', partnerId)
    .eq('client_id',    clientId)
    .in('type', ['code_sale', 'cookie_sale'])
    .is('reversed_at', null) // exclude refunded / cancelled sales
    .gte('timestamp', startInstant)
    .lt('timestamp',  endInstant)

  const salesCount   = events?.length || 0
  const totalRevenue = (events || []).reduce((s, e) => s + (e.order_value || 0), 0)

  // Does this partner earn per-sale commission at all? attributeSale() applies
  // exactly this rule when it writes commission_amount, so the payout must
  // apply it too — otherwise a partner with a value but trigger 'none' gets
  // paid a percentage of every order.
  const commissionValue   = Number(partner.commission_value) || 0
  const commissionTrigger = partner.commission_trigger || 'per_sale'
  const earnsPerSale      = commissionValue > 0 && commissionTrigger === 'per_sale'

  const commission = (events || []).reduce((s, e) => {
    // A stored 0 is a real, deliberate value — only fall back when the column
    // is genuinely absent (legacy rows written before commission_amount).
    if (e.commission_amount !== null && e.commission_amount !== undefined) {
      return s + Number(e.commission_amount)
    }
    if (!earnsPerSale) return s
    return s + (partner!.commission_type === 'flat'
      ? commissionValue
      : (e.order_value || 0) * commissionValue / 100)
  }, 0)

  // Influencers can also carry a flat retainer (`fee`). Include it once per
  // generated payout unless the caller opts out (includeFee === false) — useful
  // for a recurring monthly commission run that must not re-charge a one-time fee.
  const fee    = isInfluencer && includeFee !== false ? (Number(partner.fee) || 0) : 0
  const amount = Math.round((commission + fee) * 100) / 100

  if (salesCount === 0 && amount === 0) {
    return NextResponse.json({
      error:        `No sales found for ${selected}${selected === currentMonth ? ` (up to ${periodEnd})` : ''}`,
      partner:      partner.name,
      periodStart,  periodEnd,
    }, { status: 400 })
  }

  // ── UPSERT — regenerating same month updates the record ───────────────
  const idCols    = isInfluencer ? { influencer_id: partnerId } : { affiliate_id: partnerId }
  const onConflict = isInfluencer ? 'client_id,influencer_id,period_start' : 'client_id,affiliate_id,period_start'

  const { data: payout, error: payErr } = await sb
    .from('payouts')
    .upsert({
      client_id:    clientId,
      ...idCols,
      period_start: periodStart,
      period_end:   periodEnd,
      sales_count:  salesCount,
      revenue:      totalRevenue,
      amount,
      status:       'pending',
      generated_at: new Date().toISOString(),
    }, { onConflict })
    .select()
    .single()

  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })

  return NextResponse.json({
    payout,
    summary: {
      partner:       partner.name,
      kind:          isInfluencer ? 'influencer' : 'affiliate',
      month:         selected,
      periodStart,
      periodEnd,
      isFull:        selected !== currentMonth,
      salesCount,
      revenue:       totalRevenue,
      fee,
      commission:    Math.round(commission * 100) / 100,
      amount:        payout.amount,
      note:          selected === currentMonth
        ? `Covers ${periodStart} to ${periodEnd} (partial month — today)`
        : `Covers full month: ${periodStart} to ${periodEnd}`,
    },
  })
}
