'use client'
import { useState, useEffect } from 'react'

interface JourneyData {
  summary: { totalJourneys: number; multiTouchJourneys: number; singleTouchJourneys: number; multiTouchPct: number; avgTouches: number }
  topJourneys: { path: string; count: number; converted: number; dropped: number; convRate: number }[]
  sankeyNodes: { id: string; label: string }[]
  sankeyLinks: { source: string; target: string; value: number }[]
  assistMatrix: Record<string, Record<string, number>>
  attributedRevenue: { id: string; name: string; channel: string; revenue: number; assists: number; touches: number }[]
  model: string
}

const CHANNEL_COLOR: Record<string, string> = {
  influencer: '#d4a843', seo: '#4a9eff', affiliate: '#2ecc71',
  whatsapp: '#25d366', direct: '#9b59b6', organic: '#e67e22', social: '#e91e63', email: '#00bcd4',
}
const CHANNEL_ICON: Record<string, string> = {
  influencer: '🎯', seo: '🔍', affiliate: '🤝', whatsapp: '💬',
  direct: '🔗', organic: '🌱', social: '📱', email: '📧',
}

const MODELS = [
  { id: 'first_touch', label: 'First Touch', hint: 'Full credit to the first channel' },
  { id: 'last_touch',  label: 'Last Touch',  hint: 'Full credit to the converting channel' },
  { id: 'linear',      label: 'Linear',      hint: 'Equal credit across all touches' },
  { id: 'time_decay',  label: 'Time Decay',  hint: 'More credit to recent touches' },
]

function SankeyDiagram({ nodes, links }: { nodes: JourneyData['sankeyNodes']; links: JourneyData['sankeyLinks'] }) {
  if (links.length === 0) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
      No multi-channel journeys yet — data appears once visitors touch multiple channels
    </div>
  )

  const maxVal = Math.max(...links.map(l => l.value), 1)
  const allChannels = [...new Set([...links.map(l => l.source), ...links.map(l => l.target)])]

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 500 }}>
        {links.slice(0, 12).map((link, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 80, fontSize: 10, color: CHANNEL_COLOR[link.source] || '#888', textAlign: 'right', textTransform: 'capitalize', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              {CHANNEL_ICON[link.source]} {link.source}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                height: Math.max(8, (link.value / maxVal) * 24),
                background: `linear-gradient(90deg, ${CHANNEL_COLOR[link.source] || '#888'}88, ${CHANNEL_COLOR[link.target] || '#888'}88)`,
                borderRadius: 2,
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 9, color: '#fff', fontWeight: 600 }}>{link.value}</span>
              </div>
            </div>
            <div style={{ width: 80, fontSize: 10, color: CHANNEL_COLOR[link.target] || '#888', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 4 }}>
              {CHANNEL_ICON[link.target]} {link.target}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AssistMatrix({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const channels = Object.keys(matrix).filter(ch => Object.keys(matrix[ch]).length > 0)
  const allTargets = [...new Set(Object.values(matrix).flatMap(m => Object.keys(m)))]
  if (channels.length === 0) return (
    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No cross-channel journeys yet</div>
  )
  const maxVal = Math.max(...channels.flatMap(ch => Object.values(matrix[ch] || {})), 1)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ padding: '6px 8px', color: 'var(--text-dim)', fontWeight: 500, fontSize: 9, textAlign: 'left' }}>First → Last</th>
            {allTargets.map(t => (
              <th key={t} style={{ padding: '6px 8px', color: CHANNEL_COLOR[t] || '#888', fontWeight: 500, fontSize: 9, textTransform: 'capitalize', textAlign: 'center' }}>{CHANNEL_ICON[t]} {t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map(ch => (
            <tr key={ch} style={{ borderTop: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', color: CHANNEL_COLOR[ch] || '#888', textTransform: 'capitalize', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                {CHANNEL_ICON[ch]} {ch}
              </td>
              {allTargets.map(t => {
                const val = matrix[ch]?.[t] || 0
                const intensity = maxVal > 0 ? val / maxVal : 0
                return (
                  <td key={t} style={{ padding: '6px 8px', textAlign: 'center' }}>
                    {val > 0 ? (
                      <span style={{ display: 'inline-block', minWidth: 24, padding: '2px 6px', borderRadius: 4, background: `${CHANNEL_COLOR[t] || '#888'}${Math.round(intensity * 80 + 20).toString(16).padStart(2,'0')}`, color: 'var(--text-primary)', fontSize: 10, fontWeight: 500 }}>{val}</span>
                    ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function JourneyExplorer({ clientId, month }: { clientId?: string; month?: string }) {
  const [data, setData] = useState<JourneyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [model, setModel] = useState('first_touch')
  const [view, setView] = useState<'flow' | 'paths' | 'attribution' | 'matrix'>('flow')

  const load = (m = model) => {
    if (!clientId) return
    setLoading(true)
    fetch(`/api/analytics/journey?clientId=${clientId}&month=${month || new Date().toISOString().slice(0, 7)}&model=${m}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [clientId, month, model])

  const changeModel = (m: string) => { setModel(m); load(m) }

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Loading journey data...</div>
  if (!data) return null

  const { summary, topJourneys, sankeyNodes, sankeyLinks, assistMatrix, attributedRevenue } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total Journeys',    value: summary.totalJourneys,     color: '#4a9eff',       icon: '🗺️' },
          { label: 'Multi-Touch',       value: `${summary.multiTouchPct}%`, color: 'var(--amber)', icon: '🔀', sub: `${summary.multiTouchJourneys} journeys` },
          { label: 'Single Touch',      value: summary.singleTouchJourneys, color: '#9b59b6',      icon: '1️⃣' },
          { label: 'Avg Touchpoints',   value: summary.avgTouches,         color: '#2ecc71',       icon: '📍' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>{kpi.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{kpi.label}</div>
            {kpi.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* View tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '0.5px solid var(--border)', paddingBottom: 0 }}>
        {[
          { id: 'flow',        label: 'Flow Diagram' },
          { id: 'paths',       label: 'Top Paths' },
          { id: 'attribution', label: 'Attribution' },
          { id: 'matrix',      label: 'Channel Assist' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setView(tab.id as any)} style={{
            padding: '7px 14px', fontSize: 11, border: 'none', borderBottom: `2px solid ${view === tab.id ? 'var(--amber)' : 'transparent'}`,
            background: 'transparent', color: view === tab.id ? 'var(--amber)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: view === tab.id ? 500 : 400,
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Flow Diagram */}
      {view === 'flow' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Channel Flow — How Visitors Move Between Channels</div>
          <SankeyDiagram nodes={sankeyNodes} links={sankeyLinks} />
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>Width of bar = number of visitors who took that path. Left = first touch, Right = next touch.</div>
        </div>
      )}

      {/* Top Paths */}
      {view === 'paths' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Top Customer Journey Paths</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Journey Path', 'Visitors', 'Converted', 'Dropped', 'Conv. Rate'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', textAlign: h === 'Journey Path' ? 'left' : 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topJourneys.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No journey data yet</td></tr>
              ) : topJourneys.map((j, i) => (
                <tr key={i} style={{ borderTop: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      {j.path.split(' → ').map((ch, ci) => (
                        <span key={ci} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: `${CHANNEL_COLOR[ch] || '#888'}22`, color: CHANNEL_COLOR[ch] || '#888', textTransform: 'capitalize' }}>
                            {CHANNEL_ICON[ch]} {ch}
                          </span>
                          {ci < j.path.split(' → ').length - 1 && <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>→</span>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{j.count}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#2ecc71' }}>{j.converted}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#e74c3c' }}>{j.dropped}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: j.convRate > 20 ? '#2ecc7122' : '#e74c3c22', color: j.convRate > 20 ? '#2ecc71' : '#e74c3c' }}>{j.convRate}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Attribution */}
      {view === 'attribution' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Model selector */}
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attribution Model</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {MODELS.map(m => (
                <button key={m.id} onClick={() => changeModel(m.id)} style={{
                  padding: '6px 14px', borderRadius: 6, border: `0.5px solid ${model === m.id ? 'var(--amber)' : 'var(--border2)'}`,
                  background: model === m.id ? 'rgba(212,168,67,0.1)' : 'transparent',
                  color: model === m.id ? 'var(--amber)' : 'var(--text-muted)',
                  fontSize: 11, cursor: 'pointer', fontWeight: model === m.id ? 500 : 400,
                }}>
                  {m.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>
              {MODELS.find(m => m.id === model)?.hint}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Revenue Attribution by Partner</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Partner', 'Channel', 'Attributed Revenue', 'Touches', 'Assists'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', textAlign: h === 'Partner' ? 'left' : 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attributedRevenue.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No attributed revenue yet</td></tr>
                ) : attributedRevenue.slice(0, 20).map((p, i) => (
                  <tr key={p.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: `${CHANNEL_COLOR[p.channel] || '#888'}22`, color: CHANNEL_COLOR[p.channel] || '#888', textTransform: 'capitalize' }}>{p.channel}</span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: '#2ecc71', fontWeight: 600 }}>₹{Math.round(p.revenue).toLocaleString()}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>{p.touches}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, color: 'var(--amber)' }}>{p.assists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Channel Assist Matrix */}
      {view === 'matrix' && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 4 }}>Channel Assist Matrix</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 14 }}>How many visitors went from one channel (row) to another (column). Darker = more flow.</div>
          <AssistMatrix matrix={assistMatrix} />
        </div>
      )}
    </div>
  )
}