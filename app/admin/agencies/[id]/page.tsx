'use client'
export const runtime = 'edge'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'

export default function AdminAgencyDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [agency, setAgency] = useState<any>(null)
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [meRes, agencyRes, clientsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/agencies/${id}`),
        fetch(`/api/agencies/${id}/clients`),
      ])
      const [me, a, c] = await Promise.all([meRes.json(), agencyRes.json(), clientsRes.json()])
      if (me.role !== 'admin') { router.push('/login'); return }
      setUser(me)
      setAgency(a)
      setClients(c || [])
      setLoading(false)
    }
    load()
  }, [id])

  const updateStatus = async (status: string, status_note?: string) => {
    await fetch(`/api/agencies/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, status_note }) })
    setAgency((a: any) => ({ ...a, status, status_note }))
  }

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#3a3632' }}>Loading…</div></div>

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user} brandName={`Admin → Agency`} actions={[{ label: '← Agencies', color: 'muted', href: '/admin' }]} />

      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#e8e4dc', marginBottom: 16 }}>{agency?.name}</div>
            {[['Email', agency?.email], ['Phone', agency?.phone || '—'], ['Website', agency?.website || '—'], ['Status', agency?.status], ['Services', (agency?.services || []).join(', ') || '—'], ['Created', new Date(agency?.created_at).toLocaleDateString('en-IN')]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, borderBottom: '0.5px solid #141414', paddingBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#4a4642' }}>{l}</span>
                <span style={{ fontSize: 12, color: '#c8c4bc' }}>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => updateStatus('active')} style={{ border: `0.5px solid ${agency?.status === 'active' ? '#2ecc71' : '#2a2a2a'}`, color: agency?.status === 'active' ? '#2ecc71' : '#5a5652', background: 'transparent', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Active</button>
              <button onClick={() => updateStatus('suspended')} style={{ border: `0.5px solid ${agency?.status === 'suspended' ? '#e74c3c' : '#2a2a2a'}`, color: agency?.status === 'suspended' ? '#e74c3c' : '#5a5652', background: 'transparent', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Suspend</button>
            </div>
          </div>
          <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#c8c4bc', marginBottom: 14 }}>Managed clients ({clients.length})</div>
            {clients.length === 0 ? <div style={{ fontSize: 12, color: '#3a3632' }}>No clients yet</div> : clients.map(c => (
              <div key={c.id} style={{ padding: '10px 0', borderBottom: '0.5px solid #1a1a1a', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#c8c4bc' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#4a4642' }}>{(c.services || []).map((s: string) => s.replace(/_/g, ' ')).join(', ')}</div>
                </div>
                <span style={{ fontSize: 11, color: c.status === 'active' ? '#2ecc71' : '#d4a843' }}>● {c.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}