'use client'
export const runtime = 'edge'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

export default function AffiliateJoinPage() {
  const { clientSlug } = useParams() as { clientSlug: string }
  const [program, setProgram] = useState<any>(null)
  const [client, setClient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', handle: '', phone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    fetch(`/api/affiliate-signup/${clientSlug}`).then(async r => {
      if (!r.ok) { setError('Program not available or inactive.'); setLoading(false); return }
      const data = await r.json()
      setProgram(data.program)
      setClient(data.client)
      setLoading(false)
    }).catch(() => { setError('Failed to load program.'); setLoading(false) })
  }, [clientSlug])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch(`/api/affiliate-signup/${clientSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setError(data.error || 'Signup failed'); return }
    setResult(data)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 20, height: 20, border: '1.5px solid #1e1e1e', borderTopColor: '#d4a843', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {error ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, color: '#e8e4dc', marginBottom: 8 }}>Program unavailable</div>
            <div style={{ fontSize: 13, color: '#5a5652' }}>{error}</div>
          </div>
        ) : result ? (
          <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 16 }}>{result.welcome_back ? '👋' : '🎉'}</div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e8e4dc', marginBottom: 8 }}>{result.welcome_back ? 'Welcome back!' : 'You\'re in!'}</h1>
            <p style={{ fontSize: 13, color: '#5a5652', marginBottom: 24 }}>
              {result.welcome_back ? `Your details are unchanged, ${result.name}.` : `Welcome, ${result.name}! Here are your tracking details.`}
            </p>
            <div style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'left' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 6 }}>Your tracking link</div>
              <code style={{ fontSize: 12, color: '#d4a843', wordBreak: 'break-all' }}>{result.tracking_link}</code>
            </div>
            {result.discount_code && (
              <div style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'left' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 6 }}>Your discount code</div>
                <code style={{ fontSize: 14, fontWeight: 500, color: '#d4a843' }}>{result.discount_code}</code>
              </div>
            )}
            <button onClick={() => navigator.clipboard.writeText(result.tracking_link)} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '10px 24px', fontSize: 13, cursor: 'pointer' }}>Copy tracking link</button>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#d4a843', marginBottom: 6 }}>{client?.name}</div>
              <h1 style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc', marginBottom: 6 }}>{program?.name}</h1>
              <div style={{ fontSize: 13, color: '#5a5652' }}>
                Earn {program?.commission_value}{program?.commission_type === 'percentage' ? '%' : '₹'} per {program?.commission_trigger === 'per_sale' ? 'sale' : 'lead'}
              </div>
            </div>

            <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 12, padding: 24 }}>
              <form onSubmit={submit}>
                {[
                  { key: 'name', label: 'Full name', required: true, type: 'text', placeholder: 'Neha Sharma' },
                  { key: 'email', label: 'Email', required: true, type: 'email', placeholder: 'neha@gmail.com' },
                  { key: 'handle', label: 'Instagram / Social handle', required: true, type: 'text', placeholder: '@nehabeauty' },
                  { key: 'phone', label: 'Phone (optional)', required: false, type: 'tel', placeholder: '+91 98765 43210' },
                ].map(f => (
                  <div key={f.key} style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>
                      {f.label}{f.required && <span style={{ color: '#e74c3c', marginLeft: 3 }}>*</span>}
                    </label>
                    <input
                      type={f.type}
                      value={form[f.key as keyof typeof form]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      required={f.required}
                      style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '10px 14px', width: '100%', outline: 'none' }}
                    />
                  </div>
                ))}
                {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
                <button type="submit" disabled={submitting} style={{ width: '100%', border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '11px 0', fontSize: 13, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? 'Joining…' : 'Join as ambassador'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}