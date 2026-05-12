'use client'
import { useState, useEffect } from 'react'

const CHANNEL_COLOR: Record<string, string> = {
  influencer: '#d4a843', seo: '#4a9eff', affiliate: '#2ecc71',
  whatsapp: '#25d366', direct: '#9b59b6', organic: '#e67e22',
}
const CHANNEL_ICON: Record<string, string> = {
  influencer: '🎯', seo: '🔍', affiliate: '🤝', whatsapp: '💬',
  direct: '🔗', organic: '🌱',
}

interface ScatterPoint {
  id: string; name: string; channel: string; unique: number; converted: number
  returned: number; shared: number; freshnessRate: number; conversionRate: number; returnRate: number
}
interface OverlapPair {
  nameA: string; channelA: string; nameB: string; channelB: string; overlap: number; overlapPct: number
}
interface OverviewData {
  universe: { totalUniverse: number; totalMultiTouch: number; totalSingleTouch: number }
  scatterData: ScatterPoint[]
  overlapPairs: OverlapPair[]
}

function CrossScatter({ data }: { data: ScatterPoint[] }) {
  const [tooltip, setTooltip] = useState<ScatterPoint | null>(null)
  if (data.length === 0) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No cross-channel partner data yet</div>
  )
  const maxUnique = Math.max(...data.map(d => d.unique), 1)
  const maxConv   = Math.max(...data.map(d => d.conversionRate), 1)

  return (
    <div style={{ position: 'relative' }}>
      {/* Chart area */}
      <div style={{ position: 'relative', height: 220, margin: '8px 0 24px 32px', border: '0.5px solid var(--border)', borderRadius: 6, background: 'var(--surface2)', overflow: 'visible' }}>
        {/* Grid lines */}
        {[25, 50, 75].map(pct => (
          <div key={pct}>
            <div style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.5 }} />
            <div style={{ position: 'absolute', top: `${100 - pct}%`, left: 0, right: 0, height: 1, background: 'var(--border)', opacity: 0.5 }} />
          </div>
        ))}
        {/* Axis labels */}
        <div style={{ position: 'absolute', bottom: -20, left: 0, right: 0, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>0</span>
          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>← Unique Reach →</span>
          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{maxUnique}</span>
        </div>

        {/* Points */}
        {data.map(d => {
          const x = (d.unique / maxUnique) * 94 + 3
          const y = 100 - ((d.conversionRate / Math.max(maxConv, 1)) * 94 + 3)
          const size = Math.max(8, Math.min(22, (d.freshnessRate / 100) * 20 + 6))
          return (
            <div key={d.id}
              onMouseEnter={() => setTooltip(d)}
              onMouseLeave={() => setTooltip(null)}
              style={{
                position: 'absolute', left: `${x}%`, top: `${y}%`,
                width: size, height: size, borderRadius: '50%',
                background: CHANNEL_COLOR[d.channel] || '#888',
                opacity: 0.9, cursor: 'pointer',
                transform: 'translate(-50%, -50%)',
                border: '1.5px solid rgba(0,0,0,0.3)',
                zIndex: 2,
              }}
            />
          )
        })}

        {/* Tooltip */}
        {tooltip && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '8px 12px', zIndex: 10, minWidth: 160, pointerEvents: 'none' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{tooltip.name}</div>
            <div style={{ fontSize: 9, color: CHANNEL_COLOR[tooltip.channel], textTransform: 'capitalize', marginBottom: 6 }}>{CHANNEL_ICON[tooltip.channel]} {tooltip.channel}</div>
            {[
              ['Unique Visitors', tooltip.unique],
              ['Conversion Rate', `${tooltip.conversionRate}%`],
              ['Return Rate', `${tooltip.returnRate}%`],
              ['Freshness', `${tooltip.freshnessRate}%`],
              ['Shared Visitors', tooltip.shared],
            ].map(([l, v]) => (
              <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>
                <span>{l}</span><span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Y axis label */}
      <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', fontSize: 8, color: 'var(--text-dim)', whiteSpace: 'nowrap', transformOrigin: 'center' }}>Conv. %</div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        {['influencer','seo','affiliate','whatsapp'].map(ch => (
          <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHANNEL_COLOR[ch] }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'capitalize' }}>{ch}</span>
          </div>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>Bubble size = freshness</span>
      </div>
    </div>
  )
}

function AudienceOverlapList({ pairs }: { pairs: OverlapPair[] }) {
  if (pairs.length === 0) return (
    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No audience overlap detected this month</div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {pairs.slice(0, 8).map((pair, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 7, border: `0.5px solid ${pair.overlapPct > 50 ? '#e74c3c44' : 'var(--border)'}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: CHANNEL_COLOR[pair.channelA] || '#888', display: 'flex', alignItems: 'center', gap: 3 }}>
                {CHANNEL_ICON[pair.channelA]} <strong>{pair.nameA}</strong>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>×</span>
              <span style={{ fontSize: 11, color: CHANNEL_COLOR[pair.channelB] || '#888', display: 'flex', alignItems: 'center', gap: 3 }}>
                {CHANNEL_ICON[pair.channelB]} <strong>{pair.nameB}</strong>
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
              <div style={{ width: `${pair.overlapPct}%`, height: '100%', background: pair.overlapPct > 50 ? '#e74c3c' : 'var(--amber)', borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: pair.overlapPct > 50 ? '#e74c3c' : 'var(--amber)' }}>{pair.overlapPct}%</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{pair.overlap} shared</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function OverviewAnalytics({ clientId, month }: { clientId?: string; month?: string }) {
  const [data, setData]       = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState<'scatter' | 'overlap'>('scatter')

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    fetch(`/api/analytics/overview?clientId=${clientId}&month=${month || new Date().toISOString().slice(0,7)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, month])

  if (loading) return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading audience data...</div>
  )
  if (!data) return null

  const { universe } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Universe summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Total Audience', value: universe.totalUniverse, color: 'var(--amber)', icon: '👥' },
          { label: 'Multi-Channel',  value: universe.totalMultiTouch, color: '#4a9eff', icon: '🔀', sub: 'touched 2+ partners' },
          { label: 'Single-Channel', value: universe.totalSingleTouch, color: '#9b59b6', icon: '1️⃣' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 7, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 14 }}>{k.icon}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color, marginTop: 4 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{k.label}</div>
            {k.sub && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setView('scatter')} style={{ padding: '5px 14px', borderRadius: 6, border: `0.5px solid ${view === 'scatter' ? 'var(--amber)' : 'var(--border2)'}`, background: view === 'scatter' ? 'rgba(212,168,67,0.1)' : 'transparent', color: view === 'scatter' ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>📊 Reach vs Conv.</button>
        <button onClick={() => setView('overlap')} style={{ padding: '5px 14px', borderRadius: 6, border: `0.5px solid ${view === 'overlap' ? 'var(--amber)' : 'var(--border2)'}`, background: view === 'overlap' ? 'rgba(212,168,67,0.1)' : 'transparent', color: view === 'overlap' ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>⚠️ Audience Overlap</button>
      </div>

      {view === 'scatter' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 4 }}>All Partners — Reach vs Conversion</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>Hover over a dot to see partner details. Best performers: top-right, large bubble.</div>
          <CrossScatter data={data.scatterData} />
        </div>
      )}

      {view === 'overlap' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 4 }}>Cross-Channel Audience Overlap</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>Partners sharing the same visitors across all channels. High overlap = potential double-spend.</div>
          <AudienceOverlapList pairs={data.overlapPairs} />
        </div>
      )}
    </div>
  )
}