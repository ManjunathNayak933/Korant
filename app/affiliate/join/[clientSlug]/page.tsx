'use client'
export const runtime = 'edge'
import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface Program {
  id: string; name: string; description: string
  commission_type: string; commission_value: number; commission_trigger: string; attribution_window_days: number
}

export default function AffiliateJoinPage() {
  const { clientSlug }     = useParams() as { clientSlug: string }
  const searchParams       = useSearchParams()
  const preselectedProgram = searchParams.get('program')

  const [allPrograms, setAllPrograms] = useState<Program[]>([])
  const [program, setProgram]         = useState<Program | null>(null)
  const [client, setClient]           = useState<any>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [form, setForm]               = useState({ name: '', email: '', handle: '', phone: '' })
  const [submitting, setSubmitting]   = useState(false)
  const [result, setResult]           = useState<any>(null)

  useEffect(() => {
    const url = preselectedProgram
      ? `/api/affiliate-signup/${clientSlug}?program=${preselectedProgram}`
      : `/api/affiliate-signup/${clientSlug}`
    fetch(url).then(async r => {
      if (!r.ok) { setError('Program not available or inactive.'); setLoading(false); return }
      const data = await r.json()
      setProgram(data.program)
      setClient(data.client)
      setAllPrograms(data.allPrograms || [])
      setLoading(false)
    }).catch(() => { setError('Failed to load program.'); setLoading(false) })
  }, [clientSlug, preselectedProgram])

  const selectProgram = (prog: Program) => setProgram(prog)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const res = await fetch(`/api/affiliate-signup/${clientSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, program_id: program?.id }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setError(data.error || 'Signup failed'); return }
    setResult(data)
  }

  const inp: React.CSSProperties = { background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '10px 14px', width: '100%', outline: 'none', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 20, height: 20, border: '1.5px solid #1e1e1e', borderTopColor: '#d4a843', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {error && !program ? (
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
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#d4a843', marginBottom: 6 }}>{client?.name}</div>
              <h1 style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc', marginBottom: 4 }}>{program?.name}</h1>
              <div style={{ fontSize: 13, color: '#5a5652' }}>
                Earn {program?.commission_value}{program?.commission_type === 'percentage' ? '%' : '₹'} per {program?.commission_trigger === 'per_sale' ? 'sale' : 'lead'} · {program?.attribution_window_days}d attribution
              </div>
              {program?.description && <div style={{ fontSize: 12, color: '#4a4642', marginTop: 6 }}>{program.description}</div>}
            </div>

            {/* Program switcher — only shown when there are multiple public programs */}
            {allPrograms.length > 1 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 8 }}>Choose a program</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allPrograms.map(p => (
                    <button
                      key={p.id}
                      onClick={() => selectProgram(p)}
                      style={{
                        background: program?.id === p.id ? '#1a1505' : '#0d0d0d',
                        border: `0.5px solid ${program?.id === p.id ? '#d4a843' : '#2a2a2a'}`,
                        borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 500, color: program?.id === p.id ? '#d4a843' : '#e8e4dc', marginBottom: 2 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#5a5652' }}>
                        {p.commission_value}{p.commission_type === 'percentage' ? '%' : '₹'} per {p.commission_trigger === 'per_sale' ? 'sale' : 'lead'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 12, padding: 24 }}>
              <form onSubmit={submit}>
                {([
                  { key: 'name',   label: 'Full name',                   required: true,  type: 'text',  placeholder: 'Neha Sharma'       },
                  { key: 'email',  label: 'Email',                       required: true,  type: 'email', placeholder: 'neha@gmail.com'     },
                  { key: 'handle', label: 'Instagram / Social handle',   required: true,  type: 'text',  placeholder: '@nehabeauty'        },
                  { key: 'phone',  label: 'Phone (optional)',             required: false, type: 'tel',   placeholder: '+91 98765 43210'    },
                ] as const).map(f => (
                  <div key={f.key} style={{ marginBottom: 14 }}>
                    <label style={lbl}>{f.label}{f.required && <span style={{ color: '#e74c3c', marginLeft: 3 }}>*</span>}</label>
                    <input
                      type={f.type}
                      value={form[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      required={f.required}
                      style={inp}
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
