'use client'
import { useState, useEffect } from 'react'

interface PartnerStat {
  id: string; name: string; unique: number; returned: number
  shared: number; returnRate: number; sharedRate: number
}
export interface AssetData {
  channel: string
  channelSummary: { totalUnique: number; totalReturned: number; totalShared: number; returnRate: number; sharedRate: number }
  partnerStats: PartnerStat[]
}

const CHANNEL_COLOR: Record<string, string> = {
  influencer: 'var(--amber)', seo: '#4a9eff', affiliate: '#2ecc71', whatsapp: '#25d366',
}

// Exported hook so ChannelStatsBar can reuse the same data
export function useAssetData(clientId?: string, month?: string, channel?: string) {
  const [data, setData] = useState<AssetData | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!clientId || !channel) return
    setLoading(true)
    fetch(`/api/analytics/asset-stats?clientId=${clientId}&month=${month || new Date().toISOString().slice(0,7)}&channel=${channel}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, month, channel])
  return { data, loading }
}

export default function AssetInsights({
  clientId, month, channel,
}: {
  clientId?: string; month?: string; channel: string
}) {
  const { data, loading } = useAssetData(clientId, month, channel)
  const color = CHANNEL_COLOR[channel] || 'var(--amber)'

  if (loading) return (
    <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading visitor data...</div>
  )
  if (!data || data.partnerStats.length === 0) return (
    <div style={{ padding: 12, marginBottom: 16, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
      Install beacon to see unique / returned / shared visitor data per partner
    </div>
  )

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '9px 12px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Visitor breakdown per partner</span>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>*Shared = touched any other partner across all channels</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['Partner', 'Unique', 'Returned', 'Shared*', 'Return %', 'Shared %'].map(h => (
                <th key={h} style={{ padding: '7px 12px', fontSize: 9, fontWeight: 500, color: 'var(--text-dim)', textAlign: h === 'Partner' ? 'left' : 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.partnerStats.map(p => (
              <tr key={p.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color, fontWeight: 600 }}>{p.unique}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color: '#4a9eff' }}>{p.returned}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color: '#9b59b6' }}>{p.shared}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#4a9eff22', color: '#4a9eff' }}>{p.returnRate}%</span>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: p.sharedRate > 50 ? '#e74c3c22' : '#9b59b622', color: p.sharedRate > 50 ? '#e74c3c' : '#9b59b6' }}>{p.sharedRate}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}