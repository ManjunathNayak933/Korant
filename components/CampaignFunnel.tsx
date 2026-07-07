// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  components/CampaignFunnel.tsx                             │
// │ NEW FILE — create at <repo-root>/components/CampaignFunnel.tsx        │
// └──────────────────────────────────────────────────────────────────────┘
'use client'
import { useState, useEffect } from 'react'

interface Stage { key: string; label: string; count: number }
interface FunnelData {
  scope: { month: string; campaignId: string | null; channel: string }
  stages: Stage[]
}

// Colour + one-line hint per stage. Blue → teal → amber → green reads as a
// narrowing flow that ends on "conversion" green. Colours are the same tokens
// the rest of the dashboard uses, so dark mode is handled for us.
const STAGE_META: Record<string, { color: string; hint: string }> = {
  clicks:    { color: 'var(--blue)',  hint: 'link opens' },
  reach:     { color: '#00b3b3',      hint: 'unique visitors' },
  engaged:   { color: 'var(--amber)', hint: 'browsed store' },
  purchased: { color: 'var(--green)', hint: 'purchased' },
}

export default function CampaignFunnel({
  clientId, month, campaignId,
}: {
  clientId?: string
  month?: string
  campaignId?: string   // '' or undefined = All campaigns (overall)
}) {
  const [data, setData]       = useState<FunnelData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const m = month || new Date().toISOString().slice(0, 7)
    const url = `/api/analytics/funnel?clientId=${clientId}&month=${m}${campaignId ? '&campaignId=' + campaignId : ''}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, month, campaignId])

  const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }
  const cap:  React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }

  if (loading) return (
    <div style={card}>
      <div style={cap}>Conversion funnel</div>
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading funnel…</div>
    </div>
  )
  if (!data?.stages) return null

  const stages = data.stages
  const top    = stages[0]?.count || 0
  const final  = stages[stages.length - 1]?.count || 0

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={cap}>Conversion funnel</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          All channels combined · {campaignId ? 'selected campaign' : 'all campaigns'}
        </span>
      </div>

      {top === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
          No clicks tracked yet for this {campaignId ? 'campaign' : 'period'} — share your tracking links.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {stages.map((st, i) => {
            const meta     = STAGE_META[st.key] || { color: 'var(--blue)', hint: '' }
            const widthPct = Math.max(2, (st.count / top) * 100)
            const pctOfTop = (st.count / top) * 100
            const prev     = i > 0 ? stages[i - 1].count : null
            const dropN    = prev != null ? prev - st.count : 0
            const dropPct  = prev && prev > 0 ? (dropN / prev) * 100 : 0

            return (
              <div key={st.key}>
                {/* Drop-off connector between this stage and the previous one */}
                {i > 0 && (
                  <div style={{ marginLeft: 104, padding: '4px 0', fontSize: 10, color: dropN > 0 ? '#d9694a' : 'var(--text-dim)' }}>
                    ↓ {dropN.toLocaleString('en-IN')} dropped · {dropPct.toFixed(0)}%
                  </div>
                )}

                {/* Stage row: label · bar · count */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 92, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{st.label}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{meta.hint}</div>
                  </div>

                  <div style={{ flex: 1, height: 30, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${widthPct}%`, background: meta.color, opacity: 0.85, borderRadius: 6, transition: 'width 0.45s ease' }} />
                  </div>

                  <div style={{ width: 128, flexShrink: 0, textAlign: 'right' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{st.count.toLocaleString('en-IN')}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{pctOfTop.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {top > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border3)', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Overall: <strong style={{ color: 'var(--green)' }}>{((final / top) * 100).toFixed(2)}%</strong> of clicks purchased
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
            Engaged &amp; Purchased require the tracking beacon on your store
          </span>
        </div>
      )}
    </div>
  )
}
