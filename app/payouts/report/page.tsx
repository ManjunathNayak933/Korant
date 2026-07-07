// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/payouts/report/page.tsx                                 │
// │ Separate payout reports per section (Influencer / SEO / Affiliate).    │
// │                                                                        │
// │ Access model:                                                          │
// │   • client → owns all three sections, sees all three tabs.             │
// │   • agency → sees ONLY the sections it manages for the given client    │
// │              (?clientId=). An agency handling just Influencer sees the │
// │              Influencer tab & report only.                             │
// │   • admin  → all sections for the given ?clientId=.                    │
// │ The API re-checks the same rules, so the tabs are a convenience, not   │
// │ the security boundary.                                                 │
// └──────────────────────────────────────────────────────────────────────┘
'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'
import PayoutReport from '@/components/PayoutReport'
import { REPORT_SECTIONS, SECTION_ORDER, sectionsForServices, type ReportSection } from '@/lib/report-sections'

export default function PayoutReportPage() {
  const router = useRouter()
  const [user,     setUser]     = useState<any>(null)
  const [clientId, setClientId] = useState('')
  const [allowed,  setAllowed]  = useState<ReportSection[]>([])
  const [section,  setSection]  = useState<ReportSection>('influencer')
  const [loading,  setLoading]  = useState(true)
  const [notice,   setNotice]   = useState('')

  // IST month options (6 months back), consistent with the dashboard picker.
  const monthOptions = useMemo(() => {
    const f  = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
    const iy = Number(f.find(p => p.type === 'year')!.value)
    const im = Number(f.find(p => p.type === 'month')!.value) // 1-based IST month
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(iy, im - 1 - i, 1))
      return { val: d.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('default', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d) }
    })
  }, [])
  const [month, setMonth] = useState(monthOptions[0].val)

  useEffect(() => {
    (async () => {
      const meRes = await fetch('/api/auth/me')
      if (!meRes.ok) { router.push('/login'); return }
      const me = await meRes.json()
      setUser(me)
      const qpClient = new URLSearchParams(window.location.search).get('clientId') || ''

      if (me.role === 'client') {
        setClientId(me.id)
        setAllowed([...SECTION_ORDER])                       // a client owns every section
      } else if (me.role === 'agency') {
        if (!qpClient) { setNotice('Open a client from your portfolio to view its payout reports.'); setLoading(false); return }
        setClientId(qpClient)
        const cRes    = await fetch(`/api/agencies/${me.id}/clients`)
        const clients = await cRes.json()
        const found   = (clients || []).find((c: any) => c.id === qpClient)
        if (!found) { setNotice('You do not manage this client.'); setLoading(false); return }
        const secs = sectionsForServices(found.services || [])
        if (secs.length === 0) { setNotice('You do not manage any reportable sections for this client.'); setLoading(false); return }
        setAllowed(secs)                                     // ONLY managed sections
      } else if (me.role === 'admin') {
        if (!qpClient) { setNotice('Provide ?clientId= to view a client\u2019s payout reports.'); setLoading(false); return }
        setClientId(qpClient)
        setAllowed([...SECTION_ORDER])
      } else {
        router.push('/login'); return
      }
      setLoading(false)
    })()
  }, [])

  // Keep the active tab within the allowed set.
  useEffect(() => {
    if (allowed.length && !allowed.includes(section)) setSection(allowed[0])
  }, [allowed]) // eslint-disable-line react-hooks/exhaustive-deps

  const backAction = user?.role === 'agency'
    ? { label: '\u2190 Client', color: 'muted' as const, href: clientId ? `/agency/clients/${clientId}` : '/agency' }
    : { label: '\u2190 Payouts', color: 'muted' as const, href: '/payouts' }

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user || { email: '', role: 'client' }} brandName={user?.name} actions={[backAction]} />

      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e8e4dc', marginBottom: 4 }}>Payout reports</h1>
            <div style={{ fontSize: 13, color: '#4a4642' }}>Separate report per section</div>
          </div>
          {!notice && (
            <input type="month" value={month} max={monthOptions[0].val} onChange={e => setMonth(e.target.value)}
              style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '7px 12px', outline: 'none' }} />
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#3a3632', fontSize: 13 }}>Loading…</div>
        ) : notice ? (
          <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed #2a2a2a', borderRadius: 10 }}>
            <div style={{ fontSize: 20, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 13, color: '#5a5652' }}>{notice}</div>
          </div>
        ) : (
          <>
            {/* Section tabs — only the sections this user may access are shown */}
            <div style={{ borderBottom: '0.5px solid #1e1e1e', display: 'flex', marginBottom: 20 }}>
              {allowed.map(key => (
                <button key={key} onClick={() => setSection(key)}
                  style={{ padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${section === key ? '#d4a843' : 'transparent'}`, color: section === key ? '#e8e4dc' : '#5a5652', fontSize: 12, cursor: 'pointer' }}>
                  {REPORT_SECTIONS[key].label}
                </button>
              ))}
            </div>

            {allowed.includes(section) && <PayoutReport clientId={clientId} section={section} month={month} />}
          </>
        )}
      </div>
    </div>
  )
}
