'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props { email: string; name?: string }

export default function UserMenu({ email, name }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const initials = (name || email).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const display = email.length > 22 ? email.slice(0, 22) + '…' : email

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', border: '0.5px solid var(--border2)', borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--surface2)', border: '0.5px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 500, color: 'var(--amber)' }}>
          {initials}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{display}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4l2.5 2.5L7.5 4" stroke="var(--text-faint)" strokeWidth="1" strokeLinecap="round"/></svg>
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: 'var(--surface)', border: '0.5px solid var(--border2)', borderRadius: 8, padding: '4px 0', minWidth: 180, zIndex: 50 }}>
          <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{name || 'User'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{email}</div>
          </div>
          <button onClick={logout} style={{ width: '100%', textAlign: 'left', padding: '9px 14px', background: 'transparent', border: 'none', fontSize: 12, color: 'var(--red)', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
