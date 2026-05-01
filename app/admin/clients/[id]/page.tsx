export const runtime = 'edge'
'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'
import InfluencerChannelView from '@/components/InfluencerChannelView'
import SEODashboard from '@/components/SEODashboard'
import AffiliateDashboard from '@/components/AffiliateDashboard'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

export default function AdminClientDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [client, setClient] = useState<any>(null)
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [metrics, setMetrics] = useState<any>(null)
  const [tab, setTab] = useState<'overview' | 'influencer' | 'seo' | 'affiliate'>('overview')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [meRes, clientRes, campRes, metricsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/clients/${id}`),
        fetch(`/api/campaigns?clientId=${id}`),
        fetch(`/api/metrics?clientId=${id}`),
      ])
      const [me, c, camps, m] = await Promise.all([meRes.json(), clientRes.json(), campRes.json(), metricsRes.json()])
      if (me.role !== 'admin') { router.push('/login'); return }
      setUser(me)
      setClient(c)
      setCampaigns(camps || [])
      setMetrics(m)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#3a3632' }}>Loading…</div></div>

  const s = metrics?.summary || {}

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100vh' }}>
      <DashboardNav user={user} brandName={`Admin → ${client?.name}`} actions={[{ label: '← Clients', color: 'muted', href: '/admin' }]} />

      {/* Client info strip */}
      <div style={{ padding: '16px 24px', borderBottom: '0.5px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#e8e4dc' }}>{client?.name}</div>
          <div style={{ fontSize: 12, color: '#4a4642' }}>{client?.email}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <span style={{ background: client?.plan === 'pro' ? '#040e1a' : '#1a1a1a', border: `0.5px solid ${client?.plan === 'pro' ? '#0a1e30' : '#2a2a2a'}`, borderRadius: 4, padding: '3px 9px', fontSize: 11, color: client?.plan === 'pro' ? '#4a9eff' : '#3a3632', textTransform: 'uppercase' }}>{client?.plan}</span>
          <span style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 4, padding: '3px 9px', fontSize: 11, color: client?.status === 'active' ? '#2ecc71' : '#d4a843' }}>● {client?.status}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '0.5px solid #1e1e1e', padding: '0 24px', display: 'flex' }}>
        {(['overview', 'influencer', 'seo', 'affiliate'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '11px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${tab === t ? '#d4a843' : 'transparent'}`, color: tab === t ? '#e8e4dc' : '#5a5652', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t === 'seo' ? 'SEO' : t}</button>
        ))}
      </div>

      <div style={{ padding: '24px' }}>
        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[['Clicks', s.totalClicks || 0], ['Sales', s.totalSales || 0], ['Revenue', `₹${((s.revenueAttributed || 0) / 1000).toFixed(0)}k`], ['Conv rate', `${s.conversionRate || '0'}%`]].map(([l, v]) => (
                <div key={l as string} style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 6 }}>{l}</div>
                  <div style={{ fontSize: 22, fontWeight: 500, color: '#e8e4dc' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#c8c4bc', marginBottom: 14 }}>Account details</div>
                {[['Affiliate slug', client?.affiliate_slug], ['Custom domain', client?.custom_domain || '—'], ['Shopify domain', client?.shopify_domain || '—'], ['Managed by', client?.managed_by || 'korant'], ['Created', new Date(client?.created_at).toLocaleDateString('en-IN')]].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9, borderBottom: '0.5px solid #141414', paddingBottom: 9 }}>
                    <span style={{ fontSize: 11, color: '#4a4642' }}>{l}</span>
                    <span style={{ fontSize: 12, color: '#c8c4bc' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#c8c4bc', marginBottom: 14 }}>Channel breakdown</div>
                {['influencer', 'seo', 'affiliate'].map(ch => {
                  const c = metrics?.channels?.[ch] || {}
                  return (
                    <div key={ch} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#5a5652', textTransform: 'capitalize' }}>{ch}</span>
                        <span style={{ fontSize: 11, color: '#c8c4bc' }}>{c.clicks || 0} clicks · {c.sales || 0} sales</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        {tab === 'influencer' && <InfluencerChannelView clientId={id} campaigns={campaigns} baseUrl={BASE_URL} />}
        {tab === 'seo' && <SEODashboard clientId={id} campaigns={campaigns} baseUrl={BASE_URL} />}
        {tab === 'affiliate' && <AffiliateDashboard clientId={id} campaigns={campaigns} baseUrl={BASE_URL} />}
      </div>
    </div>
  )
}
