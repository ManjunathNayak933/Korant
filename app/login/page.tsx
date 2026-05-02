'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); setLoading(false); return }
      router.push(data.redirectPath)
    } catch (err: any) {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex' }}>
      {/* Left panel */}
      <div style={{ flex: 1, display: 'none', padding: '60px 60px', flexDirection: 'column', justifyContent: 'space-between', borderRight: '0.5px solid #1e1e1e' }} className="login-left">
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#e8e4dc', marginBottom: 6 }}>MicroKorant</div>
          <div style={{ fontSize: 12, color: '#3a3632' }}>Attribution Platform</div>
        </div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 500, color: '#e8e4dc', lineHeight: 1.3, marginBottom: 20 }}>Track every rupee.<br />Attribute every sale.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[['12,847', 'Tracked clicks'], ['₹9.2L', 'Revenue attributed'], ['342', 'Sales this month'], ['2.66%', 'Avg conv rate']].map(([v, l]) => (
              <div key={l} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: '#d4a843', marginBottom: 4 }}>{v}</div>
                <div style={{ fontSize: 11, color: '#4a4642', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#2a2622' }}>© 2026 MicroKorant · All rights reserved</div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 22, fontWeight: 500, color: '#e8e4dc', marginBottom: 6 }}>MicroKorant</div>
            <div style={{ fontSize: 13, color: '#4a4642' }}>Sign in to your account</div>
          </div>

          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@brand.com"
                required
                autoComplete="email"
                style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '10px 14px', width: '100%', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '10px 14px', width: '100%', outline: 'none' }}
              />
            </div>

            {error && (
              <div style={{ background: '#1a0404', border: '0.5px solid #2a0a0a', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#e74c3c', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', background: 'transparent', border: '0.5px solid #d4a843', color: '#d4a843', borderRadius: 7, padding: '10px 0', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {loading && <span style={{ width: 14, height: 14, border: '1.5px solid #d4a84340', borderTopColor: '#d4a843', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div style={{ marginTop: 32, padding: '16px', background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#3a3632', marginBottom: 8 }}>Don't have an account?</div>
            <div style={{ fontSize: 12, color: '#5a5652' }}>Contact your MicroKorant administrator or submit a signup request.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
