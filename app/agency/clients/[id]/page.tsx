'use client'
export const runtime = 'edge'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'
import InfluencerChannelView from '@/components/InfluencerChannelView'
import SEODashboard from '@/components/SEODashboard'
import AffiliateDashboard from '@/components/AffiliateDashboard'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

export default function AgencyClientDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [client, setClient] = useState<any>(null)
  const [managedServices, setManagedServices] = useState<string[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [tab, setTab] = useState<'influencer' | 'seo' | 'affiliate'>('influencer')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [meRes, clientRes, campRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/clients/${id}`),
        fetch(`/api/campaigns?clientId=${id}`),
      ])
      const [me, c, camps] = await Promise.all([meRes.json(), clientRes.json(), campRes.json()])
      if (me.role !== 'agency') { router.push('/login'); return }
      setUser(me)
      setClient(c)
      setCampaigns(camps || [])
      // Fetch which services this agency manages
      const handlersRes = await fetch(`/api/agencies/${me.id}/clients`)
      const handlersData = await handlersRes.json()
      const thisClient = handlersData?.find((h: any) => h.id === id)
      setManagedServices(thisClient?.services || [])
      setLoading(false)
    }
    load()
  }, [id])

  const canManage = (service: string) => managedServices.some(s => s.includes(service))

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#3a3632' }}>Loading…</div></div>

  const tabs = [
    { id: 'influencer', label: 'Influencer', locked: !canManage('influencer') },
    { id: 'seo', label: 'SEO', locked: !canManage('seo') },
    { id: 'affiliate', label: 'Affiliate', locked: !canManage('affiliate') },
  ]

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user} brandName={client?.name} actions={[{ label: '← Portfolio', color: 'muted', href: '/agency' }]} />

      <div style={{ padding: '14px 24px', borderBottom: '0.5px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: '#e8e4dc' }}>{client?.name}</div>
        <span style={{ fontSize: 11, color: '#4a4642' }}>Managing: {managedServices.map(s => s.replace(/_/g, ' ')).join(', ') || 'nothing yet'}</span>
      </div>

      <div style={{ borderBottom: '0.5px solid #1e1e1e', padding: '0 24px', display: 'flex' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => !t.locked && setTab(t.id as any)} style={{ padding: '11px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${tab === t.id ? '#d4a843' : 'transparent'}`, color: tab === t.id ? '#e8e4dc' : t.locked ? '#2a2a2a' : '#5a5652', fontSize: 12, cursor: t.locked ? 'not-allowed' : 'pointer', textDecoration: t.locked ? 'line-through' : 'none' }}>
            {t.label}{t.locked && ' 🔒'}
          </button>
        ))}
      </div>

      <div style={{ padding: '24px' }}>
        {tab === 'influencer' && (canManage('influencer') ? <InfluencerChannelView clientId={id} campaigns={campaigns} baseUrl={BASE_URL} /> : <LockedTab service="Influencer Marketing" />)}
        {tab === 'seo' && (canManage('seo') ? <SEODashboard clientId={id} campaigns={campaigns} baseUrl={BASE_URL} /> : <LockedTab service="SEO & Publications" />)}
        {tab === 'affiliate' && (canManage('affiliate') ? <AffiliateDashboard clientId={id} campaigns={campaigns} baseUrl={BASE_URL} /> : <LockedTab service="Affiliate" />)}
      </div>
    </div>
  )
}

function LockedTab({ service }: { service: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed #2a2a2a', borderRadius: 10 }}>
      <div style={{ fontSize: 20, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 14, color: '#4a4642', marginBottom: 8 }}>Not managed</div>
      <div style={{ fontSize: 12, color: '#3a3632' }}>You don't manage {service} for this client.</div>
    </div>
  )
}
