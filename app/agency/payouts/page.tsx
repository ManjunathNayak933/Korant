'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'

export default function AgencyPayoutsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [clients, setClients] = useState<any[]>([])
  const [allPayouts, setAllPayouts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))

  useEffect(() => {
    const load = async () => {
      const meRes = await fetch('/api/auth/me')
      const me = await meRes.json()
      if (me.role !== 'agency') { router.push('/login'); return }
      setUser(me)

      const clientsRes = await fetch(`/api/agencies/${me.id}/clients`)
      const clientsData = await clientsRes.json()
      setClients(clientsData || [])

      const payoutsArr: any[] = []
      for (const c of (clientsData || []).slice(0, 10)) {
        const res = await fetch(`/api/payouts?clientId=${c.id}&month=${month}`)
        const data = await res.json()
        payoutsArr.push(...(data || []).map((p: any) => ({ ...p, client_name: c.name })))
      }
      setAllPayouts(payoutsArr)
      setLoading(false)
    }
    load()
  }, [month])

  const statusColors: Record<string, string> = { pending: '#d4a843', approved: '#4a9eff', paid: '#2ecc71', disputed: '#e74c3c' }
  const total = allPayouts.reduce((s, p) => s + (p.amount || 0), 0)
  const paid = allPayouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0)

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user || { email: '', role: 'agency' }} brandName={user?.name} actions={[{ label: '← Agency', color: 'muted', href: '/agency' }]} />

      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e8e4dc' }}>Payouts across portfolio</h1>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '7px 12px', outline: 'none' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[['Total amount', `₹${total.toLocaleString('en-IN')}`], ['Paid out', `₹${paid.toLocaleString('en-IN')}`], ['Partners', allPayouts.length], ['Clients', clients.length]].map(([l, v]) => (
            <div key={l as string} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 6 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#e8e4dc' }}>{v}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#3a3632' }}>Loading payouts…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Client', 'Partner', 'Type', 'Amount', 'Status'].map(h => <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', padding: '8px 12px', textAlign: 'left', borderBottom: '0.5px solid #1a1a1a', fontWeight: 400 }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {allPayouts.map(p => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11, color: '#4a4642', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>{p.client_name}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>
                    <div style={{ fontSize: 12, color: '#c8c4bc' }}>{p.entity_name}</div>
                    <div style={{ fontSize: 10, color: '#4a4642' }}>{p.handle}</div>
                  </td>
                  <td style={{ fontSize: 12, color: '#5a5652', padding: '10px 12px', borderBottom: '0.5px solid #141414', textTransform: 'capitalize' }}>{p.entity_type}</td>
                  <td style={{ fontSize: 13, fontWeight: 500, color: '#e8e4dc', padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>₹{p.amount?.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #141414' }}>
                    <span style={{ fontSize: 11, color: statusColors[p.status] || '#5a5652' }}>● {p.status}</span>
                  </td>
                </tr>
              ))}
              {allPayouts.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#3a3632', fontSize: 13 }}>No payouts for {month}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
