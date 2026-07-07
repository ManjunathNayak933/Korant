// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  components/PayoutReport.tsx                                 │
// │ Renders ONE section's payout report. Self-contained: fetches its own   │
// │ data from /api/payout-report and handles the Forbidden case (so the    │
// │ same component is safe to drop into a client or an agency context).    │
// └──────────────────────────────────────────────────────────────────────┘
'use client'
import { useEffect, useState } from 'react'
import { REPORT_SECTIONS, type ReportSection } from '@/lib/report-sections'

const STATUS_COLORS: Record<string, string> = {
  pending:  '#d4a843',
  approved: '#4a9eff',
  paid:     '#2ecc71',
  disputed: '#e74c3c',
}

interface ReportRow {
  entity_id: string; name: string; handle: string
  sales: number; revenue: number; amount: number
  status: string; source: string; month: string
}
interface ReportData {
  summary: {
    label: string; amountLabel: string; month: string; partners: number
    totalAmount: number; paidAmount: number; pendingAmount: number
    totalSales: number; totalRevenue: number
  }
  rows: ReportRow[]
}

interface Props { clientId: string; section: ReportSection; month: string }

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`

export default function PayoutReport({ clientId, section, month }: Props) {
  const meta = REPORT_SECTIONS[section]
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [data,    setData]    = useState<ReportData | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    ;(async () => {
      try {
        const res = await fetch(
          `/api/payout-report?clientId=${encodeURIComponent(clientId)}&section=${section}&month=${month}`
        )
        const json = await res.json()
        if (!alive) return
        if (!res.ok) { setError(json.error || 'Failed to load report'); setData(null) }
        else         { setData(json); setError('') }
      } catch {
        if (alive) { setError('Network error — please try again'); setData(null) }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [clientId, section, month])

  // KPIs are derived from the returned rows so the four cards ALWAYS render and
  // mirror the "All payouts" view exactly: Total amount, Paid out, Pending
  // (count of pending payouts), Partners. When empty/loading/error they show 0.
  const rows: ReportRow[] = data?.rows || []
  const totalAmount  = rows.reduce((s, r) => s + (r.amount || 0), 0)
  const paidAmount   = rows.filter(r => r.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0)
  const pendingCount = rows.filter(r => r.status === 'pending').length
  const totalSales   = rows.reduce((s, r) => s + (r.sales || 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.revenue || 0), 0)

  return (
    <div>
      {/* KPI cards — always visible, identical set to the All payouts view */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          ['Total amount', inr(totalAmount)],
          ['Paid out',     inr(paidAmount)],
          ['Pending',      String(pendingCount)],
          ['Partners',     String(rows.length)],
        ].map(([l, v]) => (
          <div key={l} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 6 }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Body: loading / error / empty / table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#3a3632', fontSize: 13 }}>Loading {meta.label.toLowerCase()} payout report…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 48, border: '0.5px dashed #2a2a2a', borderRadius: 10, color: '#5a5652', fontSize: 13 }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed #2a2a2a', borderRadius: 10, color: '#3a3632', fontSize: 13 }}>
          No {meta.label.toLowerCase()} payouts for {month}. Click "Generate payouts" to create them.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Partner', 'Sales', 'Revenue attributed', meta.amountLabel, 'Status'].map(h => (
                <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', padding: '8px 12px', textAlign: 'left', borderBottom: '0.5px solid #1a1a1a', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.entity_id}>
                <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414' }}>
                  <div style={{ fontSize: 13, color: '#c8c4bc', fontWeight: 500 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: '#4a4642' }}>{[r.handle, r.source].filter(Boolean).join(' · ')}</div>
                </td>
                <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414', fontSize: 13, color: '#c8c4bc' }}>{r.sales}</td>
                <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414', fontSize: 13, color: '#c8c4bc' }}>{inr(r.revenue)}</td>
                <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414', fontSize: 13, fontWeight: 500, color: '#e8e4dc' }}>{inr(r.amount)}</td>
                <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414' }}>
                  <span style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: STATUS_COLORS[r.status] || '#5a5652' }}>{r.status}</span>
                </td>
              </tr>
            ))}
            {/* Totals row */}
            <tr>
              <td style={{ padding: '11px 12px', fontSize: 12, color: '#5a5652', fontWeight: 500 }}>Total</td>
              <td style={{ padding: '11px 12px', fontSize: 13, color: '#c8c4bc' }}>{totalSales}</td>
              <td style={{ padding: '11px 12px', fontSize: 13, color: '#c8c4bc' }}>{inr(totalRevenue)}</td>
              <td style={{ padding: '11px 12px', fontSize: 13, fontWeight: 600, color: '#e8e4dc' }}>{inr(totalAmount)}</td>
              <td style={{ padding: '11px 12px' }} />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}
