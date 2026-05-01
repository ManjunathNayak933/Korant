'use client'
export const runtime = 'edge'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'

export default function AgencyPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [tab, setTab] = useState<'overview' | 'clients' | 'requests'>('overview')
  const [clients, setClients] = useState<any[]>([])
  const [sentRequests, setSentRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sendModal, setSendModal] = useState(false)
  const [sendForm, setSendForm] = useState({ client_email: '', services: [] as string[], message: '' })
  const [sendLoading, setSendLoading] = useState(false)
  const [sendError, setSendError] = useState('')

  const SERVICES = [
    { value: 'influencer_marketing', label: 'Influencer Marketing' },
    { value: 'seo_digital_publications', label: 'SEO & Publications' },
    { value: 'affiliate', label: 'Affiliate' },
  ]

  const load = async () => {
    const meRes = await fetch('/api/auth/me')
    const me = await meRes.json()
    if (me.role !== 'agency') { router.push('/login'); return }
    setUser(me)

    const [clientsRes, reqRes] = await Promise.all([
      fetch(`/api/agencies/${me.id}/clients`),
      fetch('/api/agency-requests'),
    ])
    const [c, r] = await Promise.all([clientsRes.json(), reqRes.json()])
    setClients(c || [])
    setSentRequests(r || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sendRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setSendLoading(true)
    setSendError('')
    const res = await fetch('/api/agency-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sendForm) })
    const data = await res.json()
    setSendLoading(false)
    if (!res.ok) { setSendError(data.error); return }
    setSentRequests(prev => [data, ...prev])
    setSendModal(false)
    setSendForm({ client_email: '', services: [], message: '' })
  }

  const statusColor: Record<string, string> = { pending: '#d4a843', accepted: '#2ecc71', rejected: '#e74c3c' }

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav
        user={user || { email: '', role: 'agency' }}
        brandName={user?.name}
        actions={[
          { label: 'Send request', color: 'amber', onClick: () => setSendModal(true) },
          { label: 'Payouts', color: 'green', href: '/agency/payouts' },
        ]}
      />

      <div style={{ borderBottom: '0.5px solid #1e1e1e', padding: '0 24px', display: 'flex' }}>
        {[['overview', 'Portfolio'], ['clients', `Clients (${clients.length})`], ['requests', `Requests (${sentRequests.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as any)} style={{ padding: '11px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${tab === id ? '#d4a843' : 'transparent'}`, color: tab === id ? '#e8e4dc' : '#5a5652', fontSize: 12, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
              {[['Clients managed', clients.length], ['Active services', clients.reduce((s, c) => s + (c.services?.length || 0), 0)], ['Pending requests', sentRequests.filter(r => r.status === 'pending').length]].map(([l, v]) => (
                <div key={l as string} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 8 }}>{l}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: '#e8e4dc' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: '#4a4642' }}>Select the Clients tab to manage individual brand accounts.</div>
          </div>
        )}

        {tab === 'clients' && (
          <div>
            {clients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#3a3632' }}>
                <div style={{ fontSize: 14, marginBottom: 12 }}>No clients yet</div>
                <button onClick={() => setSendModal(true)} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Send a partnership request</button>
              </div>
            ) : clients.map(c => (
              <div key={c.id} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#c8c4bc', marginBottom: 4 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#4a4642', marginBottom: 4 }}>Services: {(c.services || []).map((s: string) => s.replace(/_/g, ' ')).join(', ')}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.status === 'active' ? '#2ecc71' : '#d4a843', display: 'inline-block' }} />
                      <span style={{ fontSize: 11, color: '#5a5652' }}>{c.status}</span>
                    </div>
                  </div>
                  <button onClick={() => router.push(`/agency/clients/${c.id}`)} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer' }}>View →</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'requests' && (
          <div>
            {sentRequests.map(r => (
              <div key={r.id} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#c8c4bc', marginBottom: 4 }}>→ {r.client_name} <span style={{ fontSize: 11, color: '#4a4642' }}>({r.client_email})</span></div>
                    <div style={{ fontSize: 12, color: '#4a4642' }}>{(r.services || []).map((s: string) => s.replace(/_/g, ' ')).join(', ')}</div>
                  </div>
                  <span style={{ fontSize: 12, color: statusColor[r.status] || '#5a5652', background: '#0a0a0a', border: `0.5px solid #1a1a1a`, borderRadius: 5, padding: '3px 10px' }}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sendModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setSendModal(false) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: '#e8e4dc', marginBottom: 20 }}>Send partnership request</h2>
            <form onSubmit={sendRequest}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Client email *</label>
                <input value={sendForm.client_email} onChange={e => setSendForm(f => ({ ...f, client_email: e.target.value }))} placeholder="brand@company.com" required style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 8 }}>Services *</label>
                {SERVICES.map(s => (
                  <div key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id={s.value} checked={sendForm.services.includes(s.value)} onChange={e => setSendForm(f => ({ ...f, services: e.target.checked ? [...f.services, s.value] : f.services.filter(x => x !== s.value) }))} />
                    <label htmlFor={s.value} style={{ fontSize: 12, color: '#7a7670', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>{s.label}</label>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Message</label>
                <textarea value={sendForm.message} onChange={e => setSendForm(f => ({ ...f, message: e.target.value }))} placeholder="Introduce your agency…" style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none', resize: 'vertical', minHeight: 70 }} />
              </div>
              {sendError && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{sendError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setSendModal(false)} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={sendLoading} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: sendLoading ? 'not-allowed' : 'pointer', opacity: sendLoading ? 0.7 : 1 }}>{sendLoading ? 'Sending…' : 'Send request'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
