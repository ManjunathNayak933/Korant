'use client'

interface Tab { id: string; label: string; icon?: string; soon?: boolean; locked?: boolean }
interface Props { tabs: Tab[]; active: string; onChange: (id: string) => void }

export default function ChannelTabs({ tabs, active, onChange }: Props) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', display: 'flex', overflowX: 'auto', background: 'var(--bg)' }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => !tab.locked && !tab.soon && onChange(tab.id)}
          style={{
            padding: '11px 16px',
            fontSize: 12,
            color: active === tab.id ? 'var(--text-primary)' : tab.locked ? 'var(--border2)' : 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            borderBottom: `1.5px solid ${active === tab.id ? 'var(--amber)' : 'transparent'}`,
            cursor: tab.locked || tab.soon ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            opacity: tab.soon ? 0.5 : 1,
          }}
        >
          {tab.icon && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 12,
              lineHeight: 1,
              width: 13,
              textAlign: 'center',
              letterSpacing: '0.5px',
              color: active === tab.id ? 'var(--amber)' : tab.locked ? 'var(--border2)' : 'var(--text-dim)',
            }}>{tab.icon}</span>
          )}
          {tab.label}
          {tab.soon && (
            <span style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 3, padding: '1px 5px', fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.3px' }}>
              SOON
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
