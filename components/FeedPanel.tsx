'use client'
import { useState } from 'react'

interface FeedItem { id: string; type: string; timestamp: string; order_value?: number; discount_code?: string; commission_amount?: number; city?: string; platform?: string; entity_type?: string; name?: string; handle?: string }
interface Alert { type: string; message: string; entityId?: string }
interface Props { items: FeedItem[]; alerts: Alert[]; onRefresh?: () => void }

const TYPE_COLOR: Record<string, string> = { code_sale: '#2ecc71', cookie_sale: '#2ecc71', click: '#4a9eff', ambassador_signup: '#d4a843', default: '#3a3632' }

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function itemText(item: FeedItem) {
  if (item.type === 'code_sale') return `Code sale · ${item.discount_code || ''} — ₹${item.order_value?.toLocaleString('en-IN') || 0} · ₹${item.commission_amount || 0} commission`
  if (item.type === 'cookie_sale') return `Cookie sale attributed — ₹${item.order_value?.toLocaleString('en-IN') || 0}`
  if (item.type === 'click') return `New click · ${item.city || 'Unknown city'}`
  if (item.type === 'ambassador_signup') return `Ambassador joined — ${item.name || ''} (${item.handle || ''})`
  return item.type
}

export default function FeedPanel({ items, alerts, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642' }}>Activity</span>
          {alerts.length > 0 && (
            <span style={{ background: '#1a0404', border: '0.5px solid #2a1010', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: '#e74c3c' }}>{alerts.length} alerts</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onRefresh && (
            <button onClick={onRefresh} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#3a3632', fontSize: 12 }}>↻</button>
          )}
          <button onClick={() => setCollapsed(!collapsed)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#3a3632', fontSize: 12 }}>{collapsed ? 'Show ↓' : 'Hide ↑'}</button>
        </div>
      </div>

      {!collapsed && (
        <>
          {alerts.map((alert, i) => (
            <div key={i} style={{ background: '#130f00', border: '0.5px solid #2a1f00', borderRadius: 6, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ color: '#d4a843', fontSize: 12, flexShrink: 0 }}>⚠</span>
              <span style={{ fontSize: 12, color: '#a89060', lineHeight: 1.5 }}>{alert.message}</span>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.slice(0, 8).map(item => (
              <div key={item.id} style={{ padding: '8px 0', borderBottom: '0.5px solid #181818', display: 'flex', gap: 9 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: TYPE_COLOR[item.type] || TYPE_COLOR.default, marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, color: '#6a6660', lineHeight: 1.55 }}>{itemText(item)}</div>
                  <div style={{ fontSize: 9, color: '#2a2622', marginTop: 2 }}>{timeAgo(item.timestamp)}{item.platform ? ` · ${item.platform}` : ''}</div>
                </div>
              </div>
            ))}
            {items.length === 0 && alerts.length === 0 && (
              <div style={{ fontSize: 12, color: '#3a3632', padding: '12px 0', textAlign: 'center' }}>No recent activity</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
