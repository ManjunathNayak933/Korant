'use client'
import { useState, useEffect } from 'react'

interface RetentionData {
  summary: { totalUnique: number; totalReturned: number; totalConverted: number; returnRate: number; conversionRate: number }
  returnTimeline: { day1_7: number; day8_14: number; day15_30: number; day31_90: number }
  cohort: { channel: string; total: number; returned: number; ret7d: number; ret30d: number; converted: number; returnRate: number; conversionRate: number }[]
  funnel: { stage: string; count: number; pct: number }[]
  dailyReturnChart: { date: string; count: number }[]
}

const CHANNEL_COLOR: Record<string, string> = {
  influencer: 'var(--amber)', seo: '#4a9eff', affiliate: '#2ecc71',
  whatsapp: '#25d366', direct: '#9b59b6', organic: '#e67e22', social: '#e91e63', email: '#00bcd4',
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--surface2)', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 24, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function FunnelChart({ funnel }: { funnel: RetentionData['funnel'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {funnel.map((stage, i) => (
        <div key={stage.stage}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{stage.stage}</span>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>
              {stage.count.toLocaleString()} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({stage.pct}%)</span>
            </span>
          </div>
          <div style={{ height: 28, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${stage.pct}%`,
              background: i === 0 ? '#4a9eff' : i === 1 ? 'var(--amber)' : '#2ecc71',
              transition: 'width 0.6s ease',
              display: 'flex', alignItems: 'center', paddingLeft: 8,
            }}>
              {stage.pct > 10 && <span style={{ fontSize: 10, color: '#000', fontWeight: 600 }}>{stage.pct}%</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ReturnTimelineChart({ timeline }: { timeline: RetentionData['returnTimeline'] }) {
  const bars = [
    { label: '1–7d',   value: timeline.day1_7,   color: '#4a9eff' },
    { label: '8–14d',  value: timeline.day8_14,  color: 'var(--amber)' },
    { label: '15–30d', value: timeline.day15_30, color: '#2ecc71' },
    { label: '31–90d', value: timeline.day31_90, color: '#9b59b6' },
  ]
  const max = Math.max(...bars.map(b => b.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 80, padding: '0 4px' }}>
      {bars.map(b => (
        <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>{b.value}</span>
          <div style={{ width: '100%', height: Math.max((b.value / max) * 56, 4), background: b.color, borderRadius: '3px 3px 0 0', transition: 'height 0.5s ease' }} />
          <span style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>{b.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function RetentionPanel({ clientId, month }: { clientId?: string; month?: string }) {
  const [data, setData] = useState<RetentionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    fetch(`/api/analytics/retention?clientId=${clientId}&month=${month || new Date().toISOString().slice(0, 7)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, month])

  if (loading) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Loading retention data...</div>
  )
  if (!data) return null

  const { summary, returnTimeline, cohort, funnel } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Unique Visitors', value: summary.totalUnique.toLocaleString(), color: '#4a9eff', icon: '👥' },
          { label: 'Returned',        value: summary.totalReturned.toLocaleString(), sub: `${summary.returnRate}% rate`, color: 'var(--amber)', icon: '↩️' },
          { label: 'Converted',       value: summary.totalConverted.toLocaleString(), sub: `${summary.conversionRate}% rate`, color: '#2ecc71', icon: '✅' },
          { label: 'Dropped',         value: (summary.totalUnique - summary.totalConverted).toLocaleString(), sub: `${Math.round(100 - summary.conversionRate)}% drop-off`, color: '#e74c3c', icon: '📉' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>{kpi.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{kpi.label}</div>
            {kpi.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Return Timeline */}
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Return Timeline</div>
          <ReturnTimelineChart timeline={returnTimeline} />
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>Days since first visit until they returned</div>
        </div>

        {/* Drop-off Funnel */}
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Visitor Funnel</div>
          <FunnelChart funnel={funnel} />
        </div>
      </div>

      {/* Cohort Table */}
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Retention by Acquisition Channel</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['Channel', 'Total Visitors', 'Ret. 7d', 'Ret. 30d', 'Converted', 'Return Rate', 'Conv. Rate'].map(h => (
                <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', textAlign: h === 'Channel' ? 'left' : 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohort.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No data yet — visitors tracked once tracking links are clicked</td></tr>
            ) : cohort.map((row, i) => (
              <tr key={row.channel} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: CHANNEL_COLOR[row.channel] || '#888', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{row.channel}</span>
                  </div>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <MiniBar value={row.total} max={cohort[0]?.total || 1} color={CHANNEL_COLOR[row.channel] || '#888'} />
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>{row.ret7d}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>{row.ret30d}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#2ecc71', fontWeight: 500 }}>{row.converted}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${CHANNEL_COLOR[row.channel]}22`, color: CHANNEL_COLOR[row.channel] || '#888' }}>{row.returnRate}%</span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#2ecc7122', color: '#2ecc71' }}>{row.conversionRate}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}