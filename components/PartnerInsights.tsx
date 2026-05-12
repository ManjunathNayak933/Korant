'use client'
import { useState, useEffect } from 'react'

interface PartnerStat {
  id: string; name: string; totalUnique: number; newVisitors: number; returnVisitors: number
  convertedVisitors: number; multiPartnerVisitors: number; freshnessRate: number
  returnRate: number; conversionRate: number; overlapRate: number
  avgDaysToReturn: number | null; reachabilityScore: number
}

interface PartnerData {
  partnerStats: PartnerStat[]
  overlapMatrix: { partnerA: string; nameA: string; partnerB: string; nameB: string; overlap: number; overlapPct: number }[]
  channel: string
}

const CHANNEL_COLOR: Record<string, string> = {
  influencer: 'var(--amber)', seo: '#4a9eff', affiliate: '#2ecc71', whatsapp: '#25d366',
}

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3 }}>
        <div style={{ width: `${Math.min((value / max) * 100, 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 28, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function ScatterPlot({ data }: { data: PartnerStat[] }) {
  if (data.length === 0) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No partner data yet</div>
  )
  const maxX = Math.max(...data.map(d => d.totalUnique), 1)
  const maxY = 100

  return (
    <div style={{ position: 'relative', height: 180, marginTop: 8 }}>
      {/* Axes */}
      <div style={{ position: 'absolute', bottom: 20, left: 30, right: 0, height: 1, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', bottom: 20, left: 30, top: 0, width: 1, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 30, right: 0, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>0 visitors</span>
        <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>→ Unique reach</span>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 20, width: 30, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: 'var(--text-dim)', transform: 'rotate(-90deg)', whiteSpace: 'nowrap', marginLeft: -20, marginTop: 10 }}>Conv. rate %</span>
      </div>
      {/* Points */}
      {data.map(d => {
        const x = 30 + ((d.totalUnique / maxX) * (100 - 15))
        const y = ((1 - d.conversionRate / maxY) * (100 - 15)) + '%'
        return (
          <div key={d.id} title={`${d.name}\nReach: ${d.totalUnique}\nConv: ${d.conversionRate}%\nFreshness: ${d.freshnessRate}%`}
            style={{
              position: 'absolute', left: `${x}%`, top: y,
              width: Math.max(8, Math.min(20, d.freshnessRate / 5)),
              height: Math.max(8, Math.min(20, d.freshnessRate / 5)),
              borderRadius: '50%', background: 'var(--amber)',
              opacity: 0.85, cursor: 'pointer', transform: 'translate(-50%, -50%)',
              border: '0.5px solid #000',
            }}
          >
            <div style={{ position: 'absolute', left: '100%', top: '-50%', marginLeft: 4, fontSize: 9, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{d.name.slice(0, 10)}</div>
          </div>
        )
      })}
      <div style={{ position: 'absolute', bottom: -16, left: 30, right: 0, textAlign: 'center', fontSize: 8, color: 'var(--text-dim)' }}>
        Bubble size = freshness rate (bigger = more new audience)
      </div>
    </div>
  )
}

export default function PartnerInsights({ clientId, month, channel = 'influencer' }: { clientId?: string; month?: string; channel?: string }) {
  const [data, setData] = useState<PartnerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'table' | 'scatter' | 'overlap'>('table')
  const [activeChannel, setActiveChannel] = useState(channel)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    fetch(`/api/analytics/partners?clientId=${clientId}&month=${month || new Date().toISOString().slice(0, 7)}&channel=${activeChannel}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, month, activeChannel])

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Loading partner insights...</div>
  if (!data) return null

  const { partnerStats, overlapMatrix } = data
  const color = CHANNEL_COLOR[activeChannel] || 'var(--amber)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Channel selector */}
      <div style={{ display: 'flex', gap: 6 }}>
        {['influencer', 'seo', 'affiliate'].map(ch => (
          <button key={ch} onClick={() => setActiveChannel(ch)} style={{
            padding: '5px 14px', borderRadius: 6, border: `0.5px solid ${activeChannel === ch ? CHANNEL_COLOR[ch] : 'var(--border2)'}`,
            background: activeChannel === ch ? `${CHANNEL_COLOR[ch]}22` : 'transparent',
            color: activeChannel === ch ? CHANNEL_COLOR[ch] : 'var(--text-muted)',
            fontSize: 11, cursor: 'pointer', textTransform: 'capitalize', fontWeight: activeChannel === ch ? 500 : 400,
          }}>{ch}</button>
        ))}
      </div>

      {/* View tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '0.5px solid var(--border)' }}>
        {[
          { id: 'table',   label: 'Partner Stats' },
          { id: 'scatter', label: 'Reach vs Conv.' },
          { id: 'overlap', label: 'Audience Overlap' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setView(tab.id as any)} style={{
            padding: '7px 14px', fontSize: 11, border: 'none', borderBottom: `2px solid ${view === tab.id ? color : 'transparent'}`,
            background: 'transparent', color: view === tab.id ? color : 'var(--text-muted)', cursor: 'pointer', fontWeight: view === tab.id ? 500 : 400,
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Partner Stats Table */}
      {view === 'table' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Partner', 'Unique', 'New Audience', 'Returned', 'Converted', 'Freshness', 'Reachability', 'Avg Days Back'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', textAlign: h === 'Partner' ? 'left' : 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partnerStats.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No partner data for this period</td></tr>
              ) : partnerStats.map(p => (
                <tr key={p.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{p.totalUnique}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: color }}>{p.newVisitors}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#4a9eff' }}>{p.returnVisitors}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#2ecc71', fontWeight: 500 }}>{p.convertedVisitors}</td>
                  <td style={{ padding: '10px 12px', minWidth: 100 }}>
                    <ScoreBar value={p.freshnessRate} color={color} />
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 100 }}>
                    <ScoreBar value={p.reachabilityScore} color='#2ecc71' />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {p.avgDaysToReturn !== null ? `${p.avgDaysToReturn}d` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Scatter Plot */}
      {view === 'scatter' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 4 }}>Reach vs Conversion Rate</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 16 }}>X = unique visitors reached. Y = conversion rate. Bubble size = freshness (new audience %).</div>
          <ScatterPlot data={partnerStats} />
        </div>
      )}

      {/* Overlap Matrix */}
      {view === 'overlap' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 4 }}>⚠️ Audience Overlap Warning</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Pairs below share audience — you may be paying multiple partners for the same customers. Consider staggering campaigns or negotiating exclusivity.
            </div>
          </div>

          {overlapMatrix.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, background: 'var(--surface)', borderRadius: 8 }}>No audience overlap detected</div>
          ) : overlapMatrix.map((pair, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: `0.5px solid ${pair.overlapPct > 50 ? '#e74c3c44' : 'var(--border)'}`, borderRadius: 8, padding: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{pair.nameA}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>×</span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{pair.nameB}</span>
                </div>
                <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pair.overlapPct}%`, height: '100%', background: pair.overlapPct > 50 ? '#e74c3c' : 'var(--amber)', borderRadius: 3 }} />
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: pair.overlapPct > 50 ? '#e74c3c' : 'var(--amber)' }}>{pair.overlapPct}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{pair.overlap} shared visitors</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}