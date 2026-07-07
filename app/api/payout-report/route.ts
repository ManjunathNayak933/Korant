// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/payout-report/route.ts                             │
// │ Section-scoped payout report (Influencer / SEO / Affiliate).           │
// │                                                                        │
// │ Supersedes app/api/affiliate-payout-report (affiliate-only) with a     │
// │ single endpoint that:                                                  │
// │   • returns ONE section's payout report at a time, and                 │
// │   • enforces per-section access — an agency may only pull the report   │
// │     for a section whose service it manages for that client.            │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { REPORT_SECTIONS, isReportSection, canAccessSection, type ReportSection } from '@/lib/report-sections'

// GET /api/payout-report?clientId=&section=influencer|seo|affiliate&month=YYYY-MM
export async function GET(request: NextRequest) {
  const role   = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId     = searchParams.get('clientId') || (role === 'client' ? userId : null)
  const month        = searchParams.get('month')
  const sectionParam = searchParams.get('section')

  if (!isReportSection(sectionParam)) {
    return NextResponse.json({ error: 'section must be one of: influencer, seo, affiliate' }, { status: 400 })
  }
  const section: ReportSection = sectionParam
  const meta = REPORT_SECTIONS[section]

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // ── Access control ─────────────────────────────────────────────────────
  //   client → only their own data.
  //   agency → only clients they manage AND only sections whose service they
  //            hold for that client (this is the section-scoped part).
  //   admin  → unrestricted.
  if (role === 'client') {
    if (clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (role === 'agency') {
    const { data: handlers } = await sb
      .from('agency_handlers')
      .select('service')
      .eq('agency_id', userId)
      .eq('client_id', clientId)
    const services = (handlers || []).map(h => h.service as string)
    if (services.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!canAccessSection(services, section)) {
      return NextResponse.json({ error: `You don't manage ${meta.label} for this client` }, { status: 403 })
    }
  } else if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── IST month window for the events lookup ─────────────────────────────
  // events.timestamp is timestamptz; bucket by Asia/Kolkata so this report
  // agrees with the dashboard and the payout generator. Half-open [start, end).
  let startInstant = '2000-01-01T00:00:00Z'
  let endInstant   = '2099-12-31T00:00:00Z'
  if (month) {
    const [ry, rm]      = month.split('-').map(Number)                              // rm 1-based
    const nextMonthDate = new Date(Date.UTC(ry, rm, 1)).toISOString().slice(0, 10)  // first of next month
    startInstant = new Date(`${month}-01T00:00:00+05:30`).toISOString()
    endInstant   = new Date(`${nextMonthDate}T00:00:00+05:30`).toISOString()
  }

  // ── Payout records for THIS section only ───────────────────────────────
  // select('*') (like /api/payouts) is resilient to schema differences; we read
  // only the fields we need below. A read error degrades to an empty report
  // rather than a 500, so the page still renders the KPI cards + empty state.
  let payoutQ = sb
    .from('payouts')
    .select('*')
    .eq('client_id', clientId)
    .in('entity_type', meta.entityTypes)
    .order('amount', { ascending: false })
  if (month) payoutQ = payoutQ.eq('month', month)
  const { data: payouts } = await payoutQ

  // ── Performance (sales + attributed revenue) from events ───────────────
  // Keyed by the section's FK. Sales only (not clicks); refunded/cancelled
  // rows are excluded — same rules the payout generator uses.
  const { data: events } = await sb
    .from('events')
    .select(`${meta.eventKey}, order_value`)
    .eq('client_id', clientId)
    .not(meta.eventKey, 'is', null)
    .is('reversed_at', null)
    .in('type', ['code_sale', 'cookie_sale'])
    .gte('timestamp', startInstant)
    .lt('timestamp', endInstant)

  const perf: Record<string, { sales: number; revenue: number }> = {}
  for (const e of (events || [])) {
    const key = (e as any)[meta.eventKey] as string
    if (!key) continue
    const row = perf[key] || (perf[key] = { sales: 0, revenue: 0 })
    row.sales   += 1
    row.revenue += (e as any).order_value || 0
  }

  const rows = (payouts || []).map(p => {
    const stats = perf[p.entity_id] || { sales: 0, revenue: 0 }
    return {
      entity_id:  p.entity_id,
      name:       p.entity_name,
      handle:     p.handle || '',
      sales:      stats.sales,
      revenue:    stats.revenue,
      amount:     p.amount || 0,
      status:     p.status,
      source:     p.source,
      month:      p.month,
      paid_at:    p.paid_at || null,
      paid_via:   p.paid_via || null,
      utr_number: p.utr_number || null,
    }
  })

  const summary = {
    section,
    label:         meta.label,
    amountLabel:   meta.amountLabel,
    month:         month || 'all',
    partners:      rows.length,
    totalAmount:   rows.reduce((s, r) => s + r.amount, 0),
    paidAmount:    rows.filter(r => r.status === 'paid').reduce((s, r) => s + r.amount, 0),
    pendingAmount: rows.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0),
    totalSales:    rows.reduce((s, r) => s + r.sales, 0),
    totalRevenue:  rows.reduce((s, r) => s + r.revenue, 0),
  }

  return NextResponse.json({ summary, rows })
}
