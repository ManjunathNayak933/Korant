'use client'
export const runtime = 'edge'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'
import ChannelTabs from '@/components/ChannelTabs'
import InfluencerChannelView from '@/components/InfluencerChannelView'
import SEODashboard from '@/components/SEODashboard'
import AffiliateDashboard from '@/components/AffiliateDashboard'
import FeedPanel from '@/components/FeedPanel'
import GoalsPanel from '@/components/GoalsPanel'
import AddCampaignModal from '@/components/AddCampaignModal'
import SetupModal from '@/components/SetupModal'
import WhatsAppDashboard from '@/components/WhatsAppDashboard'
import MiniBarChart from '@/components/MiniBarChart'

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : ''

const TABS = [
  { id: 'overview',    label: 'Overview',       icon: '▦' },
  { id: 'influencer',  label: 'Influencer',      icon: '🎯' },
  { id: 'seo',         label: 'SEO',             icon: '📄' },
  { id: 'affiliate',   label: 'Affiliate',       icon: '🔗' },
  { id: 'whatsapp',    label: 'WhatsApp',        icon: '💬' },
  { id: 'search',      label: 'Search Console',  icon: '🔍' },
  { id: 'meta',        label: 'Meta Ads',        icon: '▦', soon: true },
  { id: 'marketplace', label: 'Marketplace',     icon: '🛒', soon: true },
  { id: 'requests',    label: 'Requests',        icon: '🔔' },
]

// Check if setup is genuinely complete (not just the test-account pre-mark)
function getSetupStatus(onboarding: Record<string, boolean> = {}) {
  return {
    domain:      onboarding.domain_done      || onboarding.domain_skipped      || false,
    webhook:     onboarding.webhook_done     || onboarding.webhook_skipped     || false,
    attribution: onboarding.attribution_done || onboarding.attribution_skipped || false,
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')
  const [user, setUser] = useState<any>(null)
  const [metrics, setMetrics] = useState<any>(null)
  const [feed, setFeed] = useState<any>({ items: [], alerts: [] })
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddCampaign, setShowAddCampaign] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [overviewCampaign, setOverviewCampaign] = useState('')

  const currentMonth = new Date().toISOString().slice(0, 7)

  // Re-fetch metrics when user returns to overview (picks up new clicks)
  useEffect(() => {
    if (activeTab === 'overview' && user) {
      fetch(`/api/metrics?clientId=${user.id}&month=${currentMonth}&noCache=1`)
        .then(r => r.json())
        .then(setMetrics)
        .catch(() => {})
    }
  }, [activeTab])

  const load = useCallback(async () => {
    const meRes = await fetch('/api/auth/me')
    if (!meRes.ok) { router.push('/login'); return }
    const me = await meRes.json()
    if (me.status === 'paused' || me.status === 'suspended') { router.push('/paused'); return }
    setUser(me)

    // Load all data in parallel — don't wait for one before starting another
    const [metricsRes, feedRes, campRes, reqRes] = await Promise.all([
      fetch(`/api/metrics?clientId=${me.id}&month=${currentMonth}&noCache=1${overviewCampaign ? '&campaignId=' + overviewCampaign : ''}`),  // eslint-disable-line
      fetch(`/api/feed?clientId=${me.id}`),
      fetch(`/api/campaigns?clientId=${me.id}`),
      fetch('/api/agency-requests'),
    ])

    const [metricsData, feedData, campData, reqData] = await Promise.all([
      metricsRes.json(), feedRes.json(), campRes.json(), reqRes.json(),
    ])

    setMetrics(metricsData)
    setFeed(feedData || { items: [], alerts: [] })
    setCampaigns(Array.isArray(campData) ? campData : [])
    setRequests(Array.isArray(reqData) ? reqData : [])
    setLoading(false)
  }, [currentMonth])

  useEffect(() => { load() }, [load])

  // Re-fetch metrics when campaign filter changes
  useEffect(() => {
    if (!user) return
    fetch(`/api/metrics?clientId=${user.id}&month=${currentMonth}&noCache=1${overviewCampaign ? '&campaignId=' + overviewCampaign : ''}`)
      .then(r => r.json()).then(setMetrics).catch(() => {})
  }, [overviewCampaign, currentMonth])

  // Re-fetch when user returns to this tab (e.g. after clicking a tracking link)
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [load])

  const setupStatus = getSetupStatus(user?.onboarding)
  const setupDoneCount = Object.values(setupStatus).filter(Boolean).length
  const setupLabel = setupDoneCount === 3 ? 'Setup ✓' : `Setup (${setupDoneCount}/3)`

  const navActions = [
    { label: '+ Campaign', color: 'amber' as const, onClick: () => setShowAddCampaign(true) },
    { label: 'Payouts',    color: 'green' as const, href: '/payouts' },
    { label: setupLabel,   color: 'muted' as const, onClick: () => setShowSetup(true) },
  ]

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div className="spinner" style={{ width: 24, height: 24 }} />
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Loading dashboard…</div>
    </div>
  )

  const s = metrics?.summary || {}
  const channels = metrics?.channels || {}

  const clickBars = [
    { label: 'Influencer', value: channels.influencer?.clicks  || 0, color: 'var(--amber)' },
    { label: 'SEO',        value: channels.seo?.clicks         || 0, color: 'var(--blue)' },
    { label: 'Affiliate',  value: channels.affiliate?.clicks   || 0, color: 'var(--green)' },
  ]
  const revBars = [
    { label: 'Influencer', value: Math.round(channels.influencer?.revenue || 0), color: 'var(--amber)' },
    { label: 'SEO',        value: Math.round(channels.seo?.revenue        || 0), color: 'var(--blue)' },
    { label: 'Affiliate',  value: Math.round(channels.affiliate?.revenue  || 0), color: 'var(--green)' },
  ]

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <DashboardNav user={user} actions={navActions} brandName={user?.name} onRefresh={load} />
      <ChannelTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* Alert banner */}
      {feed.alerts?.length > 0 && (
        <div style={{ background: 'var(--amber-bg)', borderBottom: '0.5px solid var(--amber-border)', padding: '9px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--amber)', flex: 1 }}>
            {feed.alerts.map((a: any) => a.message).join(' · ')}
          </span>
        </div>
      )}

      <div style={{ padding: '0 24px' }}>

        {/* ─── OVERVIEW ─── */}
        {activeTab === 'overview' && (
          <>
            {/* Campaign filter for overview */}
            <div style={{ padding: '12px 0', borderBottom: '0.5px solid var(--border)', margin: '0 -24px', paddingLeft: 24, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Campaign:</span>
              <button onClick={() => setOverviewCampaign('')} style={{ padding: '4px 12px', borderRadius: 6, border: `0.5px solid ${!overviewCampaign ? 'var(--amber)' : 'var(--border2)'}`, background: 'transparent', color: !overviewCampaign ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>All</button>
              {campaigns.map(camp => (
                <button key={camp.id} onClick={() => setOverviewCampaign(camp.id)} style={{ padding: '4px 12px', borderRadius: 6, border: `0.5px solid ${overviewCampaign === camp.id ? 'var(--amber)' : 'var(--border2)'}`, background: 'transparent', color: overviewCampaign === camp.id ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>{camp.name}</button>
              ))}
              {overviewCampaign && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— showing filtered data</span>}
            </div>

            {/* KPI rows */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '0.5px solid var(--border)', margin: '0 -24px' }}>
              {[
                { label: 'Total clicks',    value: (s.totalClicks || 0).toLocaleString('en-IN') },
                { label: 'Total sales',     value: (s.totalSales  || 0).toLocaleString('en-IN') },
                { label: 'Code sales',      value: (s.codeRedemptions || 0).toLocaleString('en-IN') },
                { label: 'Conversion rate', value: `${s.conversionRate || '0.00'}%` },
              ].map(k => (
                <div key={k.label} style={{ padding: '18px 22px', borderRight: '0.5px solid var(--border)' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1 }}>{k.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '0.5px solid var(--border)', margin: '0 -24px' }}>
              {[
                { label: 'Revenue',       value: `₹${((s.revenueAttributed||0)/100000).toFixed(1)}L` },
                { label: 'Total budget',  value: `₹${((s.totalBudget||0)/1000).toFixed(0)}k` },
                { label: 'Cost / click',  value: s.avgCostPerClick ? `₹${s.avgCostPerClick.toFixed(1)}` : '—' },
                { label: 'Cost / sale',   value: s.avgCostPerSale  ? `₹${s.avgCostPerSale.toFixed(0)}`  : '—' },
              ].map(k => (
                <div key={k.label} style={{ padding: '18px 22px', borderRight: '0.5px solid var(--border)' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1 }}>{k.value}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: '24px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              {/* Channel comparison */}
              <div style={{ gridColumn: '1/-1', background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 16 }}>Channel comparison — {currentMonth}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  {[['Influencer','influencer','var(--amber)'],['SEO','seo','var(--blue)'],['Affiliate','affiliate','var(--green)']].map(([ch,key,color]) => {
                    const c = channels[key] || {}
                    return (
                      <div key={ch} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 11, color, marginBottom: 10, fontWeight: 500 }}>{ch}</div>
                        {[['Clicks', c.clicks||0], ['Sales', c.sales||0], ['Revenue', `₹${((c.revenue||0)/1000).toFixed(0)}k`]].map(([l,v])=>(
                          <div key={l as string} style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                            <span style={{ fontSize:11, color:'var(--text-dim)' }}>{l}</span>
                            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>

              <MiniBarChart title="Clicks by channel" bars={clickBars} emptyMessage="No clicks yet — share your tracking links" height={100} />
              <MiniBarChart title="Revenue by channel (₹)" bars={revBars} emptyMessage="No attributed revenue yet" height={100} />

              {/* Top influencers */}
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Top influencers</div>
                {metrics?.influencers?.length > 0 ? (
                  metrics.influencers.slice(0,5).map((inf: any) => (
                    <div key={inf.influencerId} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, paddingBottom:10, borderBottom:'0.5px solid var(--border3)' }}>
                      <div>
                        <div style={{ fontSize:12, color:'var(--text-secondary)', fontWeight:500 }}>{inf.name}</div>
                        <div style={{ fontSize:10, color:'var(--text-dim)' }}>{inf.clicks} clicks · {inf.totalSales} sales</div>
                      </div>
                      <div style={{ fontSize:12, color:'var(--amber)' }}>₹{(inf.revenueAttributed||0).toLocaleString('en-IN')}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign:'center', padding:'20px 0' }}>
                    <div style={{ fontSize:11, color:'var(--text-dim)', marginBottom:8 }}>No influencer data yet</div>
                    <button onClick={() => setActiveTab('influencer')} style={{ border:'0.5px solid var(--amber)', color:'var(--amber)', background:'transparent', borderRadius:6, padding:'5px 12px', fontSize:11, cursor:'pointer' }}>Add influencer →</button>
                  </div>
                )}
              </div>

              <FeedPanel items={feed.items||[]} alerts={feed.alerts||[]} onRefresh={load} />

              <GoalsPanel
                goals={user?.goals?.[currentMonth]||{}}
                clientId={user?.id}
                month={currentMonth}
                onUpdated={(g) => setUser((u: any) => ({ ...u, goals: { ...(u?.goals||{}), [currentMonth]: g } }))}
              />
            </div>
          </>
        )}

        {activeTab === 'influencer' && (
          <div style={{ padding: '24px 0' }}>
            <InfluencerChannelView clientId={user?.id} campaigns={campaigns} baseUrl={BASE_URL} onCampaignAdd={() => setShowAddCampaign(true)} />
          </div>
        )}

        {activeTab === 'seo' && (
          <div style={{ padding: '24px 0' }}>
            <SEODashboard clientId={user?.id} campaigns={campaigns} baseUrl={BASE_URL} onCampaignAdd={() => setShowAddCampaign(true)} />
          </div>
        )}

        {activeTab === 'affiliate' && (
          <div style={{ padding: '24px 0' }}>
            <AffiliateDashboard clientId={user?.id} campaigns={campaigns} baseUrl={BASE_URL} onCampaignAdd={() => setShowAddCampaign(true)} />
          </div>
        )}

        {activeTab === 'whatsapp' && (
          <div style={{ padding: '24px 0' }}>
            <WhatsAppDashboard clientId={user?.id} campaigns={campaigns} baseUrl={BASE_URL} />
          </div>
        )}

        {activeTab === 'requests' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 16 }}>Partnership requests</div>
            {requests.length === 0 ? (
              <div style={{ textAlign:'center', padding:60, border:'0.5px dashed var(--border2)', borderRadius:10 }}>
                <div style={{ fontSize:20, marginBottom:8 }}>🤝</div>
                <div style={{ fontSize:13, color:'var(--text-dim)' }}>No pending requests</div>
              </div>
            ) : requests.map((req: any) => (
              <div key={req.id} style={{ background:'var(--surface)', border:'0.5px solid var(--border)', borderRadius:10, padding:18, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--text-secondary)', marginBottom:4 }}>{req.agency_name}</div>
                    <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8 }}>Wants to manage: {(req.services||[]).map((s: string)=>s.replace(/_/g,' ')).join(', ')}</div>
                    {req.message && <div style={{ fontSize:12, color:'var(--text-dim)', fontStyle:'italic' }}>{req.message}</div>}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={async () => { await fetch(`/api/agency-requests/${req.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept'})}); setRequests(prev=>prev.filter(r=>r.id!==req.id)) }} style={{ border:'0.5px solid var(--green)', color:'var(--green)', background:'transparent', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer' }}>Accept</button>
                    <button onClick={async () => { await fetch(`/api/agency-requests/${req.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject'})}); setRequests(prev=>prev.filter(r=>r.id!==req.id)) }} style={{ border:'0.5px solid var(--red)', color:'var(--red)', background:'transparent', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer' }}>Decline</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'search' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ background:'var(--surface)', border:'0.5px solid var(--border)', borderRadius:10, padding:24, maxWidth:500 }}>
              <div style={{ fontSize:14, fontWeight:500, color:'var(--text-primary)', marginBottom:8 }}>Google Search Console</div>
              <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:20, lineHeight:1.7 }}>Connect your GSC property to see keyword rankings alongside attribution data.</p>
              <a href="/api/integrations/gsc" style={{ border:'0.5px solid var(--blue)', color:'var(--blue)', borderRadius:7, padding:'8px 18px', fontSize:13, textDecoration:'none', display:'inline-block' }}>Connect Google Search Console</a>
            </div>
          </div>
        )}

        {(activeTab === 'meta' || activeTab === 'marketplace') && (
          <div style={{ padding:'60px 0', display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ fontSize:28, marginBottom:12 }}>🚧</div>
            <div style={{ fontSize:15, fontWeight:500, color:'var(--text-primary)', marginBottom:6 }}>Coming soon</div>
            <div style={{ fontSize:13, color:'var(--text-muted)' }}>This feature is in development.</div>
          </div>
        )}
      </div>

      {showAddCampaign && (
        <AddCampaignModal clientId={user?.id} onClose={() => setShowAddCampaign(false)} onCreated={c => { setCampaigns(prev => [c, ...prev]); setShowAddCampaign(false) }} />
      )}

      {showSetup && (
        <SetupModal
          user={user}
          onClose={() => setShowSetup(false)}
          onSave={(ob) => setUser((u: any) => ({ ...u, onboarding: ob }))}
        />
      )}
    </div>
  )
}
