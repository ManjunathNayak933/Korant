'use client'
import { useEffect, useState } from 'react'

export default function PausedPage() {
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setUser).catch(() => {})
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#d4a843', marginBottom: 8 }}>korant</div>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#1a0000', border: '0.5px solid #2a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px auto', fontSize: 20 }}>⏸</div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc', marginBottom: 8 }}>Account {user?.status || 'paused'}</h1>
        <p style={{ fontSize: 13, color: '#5a5652', marginBottom: 24, lineHeight: 1.7 }}>
          {user?.status_note || 'Your account has been temporarily paused. Please contact the Korant team to restore access.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <a href="mailto:support@korant.app" style={{ border: '0.5px solid #d4a843', color: '#d4a843', borderRadius: 7, padding: '8px 18px', fontSize: 13, textDecoration: 'none', display: 'inline-block' }}>Contact support</a>
          <button onClick={logout} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
