'use client'
import Link from 'next/link'
import UserMenu from './UserMenu'
import { useTheme } from './ThemeProvider'

interface NavAction { label: string; color: 'amber' | 'green' | 'blue' | 'muted'; onClick?: () => void; href?: string }
interface Props {
  user: { email: string; name?: string; role: string }
  actions?: NavAction[]
  brandName?: string
  onRefresh?: () => void
}

const COLOR_MAP = {
  amber: { border: 'var(--amber)', color: 'var(--amber)' },
  green: { border: 'var(--green)', color: 'var(--green)' },
  blue:  { border: 'var(--blue)', color: 'var(--blue)' },
  muted: { border: 'var(--border2)', color: 'var(--text-muted)' },
}

export default function DashboardNav({ user, actions = [], brandName, onRefresh }: Props) {
  const { theme, toggle } = useTheme()

  return (
    <nav style={{ background: 'var(--bg)', borderBottom: '0.5px solid var(--border)', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 54, position: 'sticky', top: 0, zIndex: 40 }}>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>korant</span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.3px' }}>{brandName || 'Dashboard'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {actions.map((a, i) => {
          const s = { ...COLOR_MAP[a.color], background: 'transparent', border: `0.5px solid ${COLOR_MAP[a.color].border}`, borderRadius: 7, padding: '6px 13px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }
          if (a.href) return <Link key={i} href={a.href} style={{ ...s, textDecoration: 'none', color: COLOR_MAP[a.color].color }}>{a.label}</Link>
          return <button key={i} onClick={a.onClick} style={s}>{a.label}</button>
        })}

        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ width: 30, height: 30, borderRadius: 7, border: '0.5px solid var(--border2)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <UserMenu email={user.email} name={user.name} />
      </div>
    </nav>
  )
}
