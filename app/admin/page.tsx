'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'

type AdminTab = 'clients' | 'agencies' | 'signups'

export default function AdminPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [tab, setTab] = useState<AdminTab>('clients')
  const [clients, setClients] = useState<any[]>([])
  const [agencies, setAgencies] = useState<any[]>([])
  const [signups, setSignups] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [signupFilter, setSignupFilter] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [rejectModal, setRejectModal] = useState<any>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [manageModal, setManageModal] = useState<any>(null)
  const [manageForm, setManageForm] = useState<any>({})
  const [searchClients, setSearchClients] = useState('')

  const load = async () => {
    setLoading(true)
    const meRes = await fetch('/api/auth/me')
    const me = await meRes.json()
    if (me.role !== 'admin') { router.push('/login'); return }
    setUser(me)

    const [clientsRes, agenciesRes, signupsRes, statsRes] = await Promise.all([
      fetch('/api/clients'),
      fetch('/api/agencies'),
      fetch(`/api/signup-requests?status=${signupFilter}`),
      fetch('/api/admin/portfolio-stats'),
    ])
    const [c, a, s, st] = await Promise.all([clientsRes.json(), agenciesRes.json(), signupsRes.json(), statsRes.json()])
    setClients(c || [])
    setAgencies(a || [])
    setSignups(s || [])
    setStats(st || {})
    setLoading(false)
  }

  useEffect(() => { load() }, [signupFilter])

  const approveSignup = async (id: string) => {
    const res = await fetch(`/api/signup-requests/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) })
    const data = await res.json()
    if (!res.ok) { alert(`Error: ${data.error}`); return }
    setSignups(prev => prev.filter(s => s.id !== id))
  }

  const rejectSignup = async (id: string) => {
    await fetch(`/api/signup-requests/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject', rejected_reason: rejectReason }) })
    setSignups(prev => prev.filter(s => s.id !== id))
    setRejectModal(null)
    setRejectReason('')
  }

  const saveManage = async () => {
    await fetch(`/api/admin/clients/${manageModal.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manageForm) })
    setClients(prev => prev.map(c => c.id === manageModal.id ? { ...c, ...manageForm } : c))
    setManageModal(null)
  }

  const filteredClients = clients.filter(c => !searchClients || c.name.toLowerCase().includes(searchClients.toLowerCase()) || c.email.toLowerCase().includes(searchClients.toLowerCase()))

  const statusColor: Record<string, string> = { active: '#2ecc71', paused: '#d4a843', suspended: '#e74c3c' }
  const planColor: Record<string, string> = { pro: '#4a9eff', basic: '#3a3632' }

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user || { email: '', role: 'admin' }} brandName="Admin" />

      {/* B2: base-URL health — a misconfigured origin silently breaks Shopify
          order/checkout capture, so make it loud and impossible to miss. */}
      {stats?.configHealth && !stats.configHealth.ok && (
        <div style={{ background: '#2a1408', borderBottom: '1px solid #7a3a12', padding: '12px 24px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ color: '#e0902a', fontSize: 16, lineHeight: '20px' }}>⚠</span>
          <div style={{ fontSize: 12.5, color: '#f0c890', lineHeight: 1.6 }}>
            <strong style={{ color: '#f4b063' }}>Deployment config issue — Shopify captures may be silently failing.</strong><br/>
            {stats.configHealth.message}
          </div>
        </div>
      )}

      {/* Platform stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '0.5px solid #1e1e1e', padding: '0' }}>
          {[['MRR', `₹${(stats.mrr / 1000).toFixed(0)}k`], ['Active clients', stats.activeClients], ['Total clients', stats.totalClients], ['Agencies', stats.totalAgencies], ['Pro clients', stats.proClients]].map(([l, v]) => (
            <div key={l as string} style={{ padding: '14px 20px', borderRight: '0.5px solid #1e1e1e' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 5 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '0.5px solid #1e1e1e', padding: '0 24px', display: 'flex' }}>
        {(['clients', 'agencies', 'signups'] as AdminTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '11px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${tab === t ? '#d4a843' : 'transparent'}`, color: tab === t ? '#e8e4dc' : '#5a5652', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
            {t}{t === 'signups' && signups.filter(s => s.status === 'pending').length > 0 && ` (${signups.filter(s => s.status === 'pending').length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {/* Clients tab */}
        {tab === 'clients' && (
          <div>
            <input value={searchClients} onChange={e => setSearchClients(e.target.value)} placeholder="Search clients…" style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 14px', width: 280, outline: 'none', marginBottom: 16 }} />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Name', 'Email', 'Plan', 'Status', 'Next billing', 'Actions'].map(h => <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', padding: '8px 12px', textAlign: 'left', borderBottom: '0.5px solid #1a1a1a', fontWeight: 400 }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filteredClients.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontSize: 13, color: '#c8c4bc', padding: '10px 12px', borderBottom: '0.5px solid #141414', fontWeight: 500 }}>{c.name}</td>
                    <td style={{ fontSize: 12, color: '#5a5652', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>{c.email}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>
                      <span style={{ background: c.plan === 'pro' ? '#040e1a' : '#1a1a1a', border: `0.5px solid ${c.plan === 'pro' ? '#0a1e30' : '#2a2a2a'}`, borderRadius: 4, padding: '2px 7px', fontSize: 10, color: planColor[c.plan] || '#5a5652', textTransform: 'uppercase' }}>{c.plan}</span>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>
                      <span style={{ color: statusColor[c.status] || '#5a5652', fontSize: 12 }}>● {c.status}</span>
                    </td>
                    <td style={{ fontSize: 11, color: '#3a3632', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>{c.next_billing_at ? new Date(c.next_billing_at).toLocaleDateString('en-IN') : '—'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414', display: 'flex', gap: 8 }}>
                      <button onClick={() => { setManageModal(c); setManageForm({ status: c.status, plan: c.plan, status_note: c.status_note || '' }) }} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Manage</button>
                      <button onClick={() => router.push(`/admin/clients/${c.id}`)} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Agencies tab */}
        {tab === 'agencies' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Name', 'Email', 'Services', 'Status', 'Actions'].map(h => <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', padding: '8px 12px', textAlign: 'left', borderBottom: '0.5px solid #1a1a1a', fontWeight: 400 }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {agencies.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontSize: 13, color: '#c8c4bc', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>{a.name}</td>
                    <td style={{ fontSize: 12, color: '#5a5652', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>{a.email}</td>
                    <td style={{ fontSize: 11, color: '#4a4642', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>{(a.services || []).map((s: string) => s.replace(/_/g, ' ')).join(', ')}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414' }}><span style={{ color: statusColor[a.status] || '#5a5652', fontSize: 12 }}>● {a.status}</span></td>
                    <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>
                      <button onClick={() => router.push(`/admin/agencies/${a.id}`)} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Signups tab */}
        {tab === 'signups' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {['pending', 'approved', 'rejected', 'all'].map(f => (
                <button key={f} onClick={() => setSignupFilter(f)} style={{ padding: '5px 12px', borderRadius: 5, border: `0.5px solid ${signupFilter === f ? '#d4a843' : '#2a2a2a'}`, color: signupFilter === f ? '#d4a843' : '#5a5652', background: 'transparent', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {signups.map(req => (
                <div key={req.id} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ background: req.type === 'client' ? '#040e1a' : '#061a0a', border: `0.5px solid ${req.type === 'client' ? '#0a1e30' : '#0a2a10'}`, borderRadius: 4, padding: '2px 7px', fontSize: 10, color: req.type === 'client' ? '#4a9eff' : '#2ecc71', textTransform: 'capitalize' }}>{req.type}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#e8e4dc' }}>{req.brand_name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#5a5652', marginBottom: 4 }}>{req.full_name} · {req.email}</div>
                  <div style={{ fontSize: 12, color: '#5a5652', marginBottom: 4 }}>{req.phone}</div>
                  {req.plan && <div style={{ fontSize: 11, color: '#4a4642', marginBottom: 4 }}>Plan: {req.plan}</div>}
                  {req.services?.length > 0 && <div style={{ fontSize: 11, color: '#4a4642', marginBottom: 4 }}>Services: {req.services.map((s: string) => s.replace(/_/g, ' ')).join(', ')}</div>}
                  {req.note && <div style={{ fontSize: 12, color: '#4a4642', fontStyle: 'italic', marginBottom: 12 }}>"{req.note}"</div>}
                  <div style={{ fontSize: 10, color: '#2a2622', marginBottom: 12 }}>{new Date(req.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  {req.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => approveSignup(req.id)} style={{ flex: 1, border: '0.5px solid #2ecc71', color: '#2ecc71', background: 'transparent', borderRadius: 6, padding: '7px 0', fontSize: 12, cursor: 'pointer' }}>Approve</button>
                      <button onClick={() => setRejectModal(req)} style={{ flex: 1, border: '0.5px solid #e74c3c', color: '#e74c3c', background: 'transparent', borderRadius: 6, padding: '7px 0', fontSize: 12, cursor: 'pointer' }}>Reject</button>
                    </div>
                  )}
                  {req.status !== 'pending' && (
                    <div style={{ fontSize: 12, color: req.status === 'approved' ? '#2ecc71' : '#e74c3c' }}>{req.status === 'approved' ? '✓ Approved' : '✕ Rejected'}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reject modal */}
      {rejectModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setRejectModal(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 12, padding: 24, width: '90%', maxWidth: 400 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: '#e8e4dc', marginBottom: 16 }}>Reject {rejectModal.brand_name}?</h2>
            <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Reason (optional)</label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection…" style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none', resize: 'vertical', minHeight: 80, marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setRejectModal(null)} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => rejectSignup(rejectModal.id)} style={{ border: '0.5px solid #e74c3c', color: '#e74c3c', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage client modal */}
      {manageModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setManageModal(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 12, padding: 24, width: '90%', maxWidth: 400 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: '#e8e4dc', marginBottom: 20 }}>Manage — {manageModal.name}</h2>
            {[['Status', 'status', ['active', 'paused', 'suspended']], ['Plan', 'plan', ['basic', 'pro']]].map(([label, key, opts]) => (
              <div key={key as string} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>{label}</label>
                <select value={manageForm[key as string]} onChange={e => setManageForm((f: any) => ({ ...f, [key as string]: e.target.value }))} style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none' }}>
                  {(opts as string[]).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Status note</label>
              <input value={manageForm.status_note} onChange={e => setManageForm((f: any) => ({ ...f, status_note: e.target.value }))} placeholder="Optional note shown on paused page" style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setManageModal(null)} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveManage} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
