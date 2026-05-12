'use client'
import { useState, useEffect } from 'react'

interface PartnerStat {
  id: string; name: string; unique: number; returned: number
  shared: number; returnRate: number; sharedRate: number
}
interface AssetData {
  channel: string
  channelSummary: { totalUnique: number; totalReturned: number; totalShared: number; returnRate: number; sharedRate: number }
  partnerStats: PartnerStat[]
}

const CHANNEL_COLOR: Record<string, string> = {
  influencer: 'var(--amber)', seo: '#4a9eff', affiliate: '#2ecc71', whatsapp: '#25d366',
}

function StatPill({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '6px 10px', background: `${color}11`, borderRadius: 6, border: `0.5px solid ${color}33` }}>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 1 }}>{label}</div>
    </div>
  )
}

export default function AssetInsights({
  clientId, month, channel, partnerIds,
}: {
  clientId?: string; month?: string; channel: string; partnerIds?: Record<string, string> // id → name mapping
}) {
  const [data, setData]     = useState<AssetData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    fetch(`/api/analytics/asset-stats?clientId=${clientId}&month=${month || new Date().toISOString().slice(0,7)}&channel=${channel}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, month, channel])

  if (loading) return (
    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading visitor insights...</div>
  )
  if (!data || data.partnerStats.length === 0) return (
    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
      No visitor data yet — install the tracking beacon on your store to see return visitor data
    </div>
  )

  const color = CHANNEL_COLOR[channel] || 'var(--amber)'
  const { channelSummary, partnerStats } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Channel-level summary pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <StatPill value={channelSummary.totalUnique}   label="Unique"   color={color} />
        <StatPill value={channelSummary.totalReturned} label="Returned" color='#4a9eff' />
        <StatPill value={channelSummary.totalShared}   label="Shared"   color='#9b59b6' />
        <StatPill value={`${channelSummary.returnRate}%`} label="Return Rate" color='#2ecc71' />
        <StatPill value={`${channelSummary.sharedRate}%`} label="Shared Rate" color='#e67e22' />
      </div>

      {/* Per-partner table */}
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['Partner', 'Unique Visitors', 'Returned', 'Shared*', 'Return %', 'Shared %'].map(h => (
                <th key={h} style={{ padding: '7px 12px', fontSize: 9, fontWeight: 500, color: 'var(--text-dim)', textAlign: h === 'Partner' ? 'left' : 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partnerStats.map(p => (
              <tr key={p.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: '9px 12px', textAlign: 'center', fontSize: 12, color, fontWeight: 600 }}>{p.unique}</td>
                <td style={{ padding: '9px 12px', textAlign: 'center', fontSize: 12, color: '#4a9eff' }}>{p.returned}</td>
                <td style={{ padding: '9px 12px', textAlign: 'center', fontSize: 12, color: '#9b59b6' }}>{p.shared}</td>
                <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#4a9eff22', color: '#4a9eff' }}>{p.returnRate}%</span>
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: p.sharedRate > 50 ? '#e74c3c22' : '#9b59b622', color: p.sharedRate > 50 ? '#e74c3c' : '#9b59b6' }}>{p.sharedRate}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '7px 12px', borderTop: '0.5px solid var(--border)', fontSize: 9, color: 'var(--text-dim)' }}>
          * Shared = visitors who also touched at least one other partner across any channel (influencer, SEO, affiliate, WhatsApp)
        </div>
      </div>
    </div>
  )
}