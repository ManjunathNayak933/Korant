export const runtime = 'edge'
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'

export default function PayoutsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [payouts, setPayouts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [generating, setGenerating] = useState(false)
  const [payModal, setPayModal] = useState<any>(null)
  const [payForm, setPayForm] = useState({ paid_via: '', utr_number: '', notes: '' })

  const load = async (m: string) => {
    const meRes = await fetch('/api/auth/me')
    const me = await meRes.json()
    setUser(me)
    const clientId = me.role === 'client' ? me.id : new URLSearchParams(window.location.search).get('clientId') || ''
    const res = await fetch(`/api/payouts?clientId=${clientId}&month=${m}`)
    const data = await res.json()
    setPayouts(data || [])
    setLoading(false)
  }

  useEffect(() => { load(month) }, [month])

  const generate = async () => {
    setGenerating(true)
    const clientId = user?.role === 'client' ? user.id : ''
    const res = await fetch('/api/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', clientId, month }) })
    const data = await res.json()
    setGenerating(false)
    if (res.ok) load(month)
    else alert(data.error)
  }

  const updateStatus = async (id: string, status: string) => {
    const body: any = { status }
    if (status === 'paid') Object.assign(body, payForm)
    await fetch(`/api/payouts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setPayouts(prev => prev.map(p => p.id === id ? { ...p, status, ...body } : p))
    setPayModal(null)
  }

  const statusColors: Record<string, string> = { pending: '#d4a843', approved: '#4a9eff', paid: '#2ecc71', disputed: '#e74c3c' }
  const total = payouts.reduce((s, p) => s + (p.amount || 0), 0)
  const paid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0)

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user || { email: '', role: 'client' }} brandName={user?.name} actions={[{ label: '← Dashboard', color: 'muted', href: '/dashboard' }]} />

      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e8e4dc', marginBottom: 4 }}>Payouts</h1>
            <div style={{ fontSize: 13, color: '#4a4642' }}>Manage partner payouts</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '7px 12px', outline: 'none' }} />
            <button onClick={generate} disabled={generating} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1 }}>
              {generating ? 'Generating…' : 'Generate payouts'}
            </button>
            <button onClick={() => window.open(`/api/export?type=payouts&clientId=${user?.id}&month=${month}`, '_blank')} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>↓ Export</button>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[['Total amount', `₹${total.toLocaleString('en-IN')}`], ['Paid out', `₹${paid.toLocaleString('en-IN')}`], ['Pending', payouts.filter(p => p.status === 'pending').length], ['Partners', payouts.length]].map(([l, v]) => (
            <div key={l as string} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 6 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        {payouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed #2a2a2a', borderRadius: 10, color: '#3a3632' }}>No payouts for {month}. Click "Generate payouts" to create them.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Partner', 'Type', 'Amount', 'Status', 'Actions'].map(h => <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', padding: '8px 12px', textAlign: 'left', borderBottom: '0.5px solid #1a1a1a', fontWeight: 400 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id}>
                  <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414' }}>
                    <div style={{ fontSize: 13, color: '#c8c4bc', fontWeight: 500 }}>{p.entity_name}</div>
                    <div style={{ fontSize: 11, color: '#4a4642' }}>{p.handle || ''} · {p.source}</div>
                  </td>
                  <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414', fontSize: 12, color: '#5a5652', textTransform: 'capitalize' }}>{p.entity_type}</td>
                  <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414', fontSize: 13, fontWeight: 500, color: '#e8e4dc' }}>₹{p.amount?.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414' }}>
                    <span style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: statusColors[p.status] || '#5a5652' }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '11px 12px', borderBottom: '0.5px solid #141414' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {p.status === 'pending' && <button onClick={() => updateStatus(p.id, 'approved')} style={{ border: '0.5px solid #4a9eff', color: '#4a9eff', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Approve</button>}
                      {p.status === 'approved' && <button onClick={() => setPayModal(p)} style={{ border: '0.5px solid #2ecc71', color: '#2ecc71', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Mark paid</button>}
                      {p.status !== 'disputed' && <button onClick={() => updateStatus(p.id, 'disputed')} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Dispute</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setPayModal(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 12, padding: 24, width: '90%', maxWidth: 380 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: '#e8e4dc', marginBottom: 20 }}>Mark paid — {payModal.entity_name}</h2>
            {[['paid_via', 'Paid via', 'Bank transfer / UPI / etc.'], ['utr_number', 'UTR / Reference number', ''], ['notes', 'Notes', '']].map(([key, label, ph]) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>{label}</label>
                <input value={payForm[key as keyof typeof payForm]} onChange={e => setPayForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph as string} style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none' }} />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setPayModal(null)} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => updateStatus(payModal.id, 'paid')} style={{ border: '0.5px solid #2ecc71', color: '#2ecc71', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Confirm payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
