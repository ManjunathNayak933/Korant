// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/dashboard/page.tsx                                     │
// │ Replace the existing file at <repo-root>/app/dashboard/page.tsx      │
// └──────────────────────────────────────────────────────────────────────┘
'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'
import ChannelTabs from '@/components/ChannelTabs'
import InfluencerChannelView from '@/components/InfluencerChannelView'
import AnalyticsDashboard from '@/components/AnalyticsDashboard'
import SEODashboard from '@/components/SEODashboard'
import AffiliateDashboard from '@/components/AffiliateDashboard'
import FeedPanel from '@/components/FeedPanel'
import GoalsPanel from '@/components/GoalsPanel'
import AddCampaignModal from '@/components/AddCampaignModal'
import SetupModal from '@/components/SetupModal'
import WhatsAppDashboard from '@/components/WhatsAppDashboard'
import MiniBarChart from '@/components/MiniBarChart'
import OverviewAnalytics from '@/components/OverviewAnalytics'
import InfluencerCenter from '@/components/InfluencerCenter'
import MarketView from '@/components/MarketView'

interface UserProfile {
  id: string; name: string; email: string; status: string; role: string
  onboarding?: Record<string, boolean>
  goals?: Record<string, Record<string, number>>
}
interface ChannelData {
  clicks: number; sales: number; revenue: number; budget: number
  codeRedemptions?: number; avgCostPerClick?: number
  sent?: number; read?: number
}
interface MetricsSummary {
  totalClicks: number; totalSales: number; codeRedemptions: number
  conversionRate: number; revenueAttributed: number; totalBudget: number
  avgCostPerClick: number; avgCostPerSale: number
}
interface MetricsData {
  summary: MetricsSummary
  channels: Record<string, ChannelData>
  influencers: any[]; publications: any[]; affiliates: any[]
  geoPoints: any[]
  eventsTruncated?: boolean
}
interface FeedData { items: any[]; alerts: { message: string; type: string }[] }

const TABS = [
  { id: 'overview',    label: 'Overview',       icon: 'O' },
  { id: 'influencer',  label: 'Influencer',     icon: 'I' },
  { id: 'seo',         label: 'SEO',            icon: 'S' },
  { id: 'affiliate',   label: 'Affiliate',      icon: 'A' },
  { id: 'whatsapp',    label: 'WhatsApp',       icon: 'W' },
  { id: 'search',      label: 'Search Console', icon: 'S' },
  { id: 'analytics',   label: 'Analytics',      icon: 'A' },
  { id: 'marketplace', label: 'Marketplace',    icon: 'M',  soon: true },
  { id: 'influencer-center', label: 'Influencer Center', icon: 'I' },
  { id: 'market-view',       label: 'Market View',        icon: 'M' },
  { id: 'requests',    label: 'Requests',       icon: 'R' },
]

// Only _done fields count toward the progress counter.
// _skipped means "I'll do this later" — it does NOT mark the step complete.
function getSetupDoneCount(onboarding: Record<string, boolean> = {}) {
  return [
    onboarding.domain_done,
    onboarding.tracking_done,
    onboarding.webhook_done,
  ].filter(Boolean).length
}

export default function DashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab]               = useState('overview')
  const [user, setUser]                         = useState<UserProfile | null>(null)
  const [metrics, setMetrics]                   = useState<MetricsData | null>(null)
  const [feed, setFeed]                         = useState<FeedData>({ items: [], alerts: [] })
  const [campaigns, setCampaigns]               = useState<any[]>([])
  const [requests, setRequests]                 = useState<any[]>([])
  const [loading, setLoading]                   = useState(true)
  const [showAddCampaign, setShowAddCampaign]   = useState(false)
  const [showSetup, setShowSetup]               = useState(false)
  const [overviewCampaign, setOverviewCampaign] = useState('')
  const [universeStats, setUniverseStats]       = useState({ totalUniverse: 0, totalMultiTouch: 0, totalSingleTouch: 0 })
  const [baseUrl, setBaseUrl]                   = useState('')
  // BUG FIX: deep links from the Influencer Center land here as
  // /dashboard?tab=influencer&prefill=<json>. These were previously ignored, so
  // "Add to My Account" dropped the user on Overview with an empty Add form.
  const [influencerPrefill, setInfluencerPrefill] = useState<{ name?: string; handle?: string; platform?: string; social_url?: string } | undefined>(undefined)

  // Stable base URL after hydration + honor any ?tab / ?prefill deep link
  useEffect(() => {
    setBaseUrl(window.location.origin)
    try {
      const sp = new URLSearchParams(window.location.search)
      const tab = sp.get('tab')
      if (tab && TABS.some(t => t.id === tab)) setActiveTab(tab)
      const pf = sp.get('prefill')
      if (pf) setInfluencerPrefill(JSON.parse(pf))
      // Strip the params so a refresh doesn't re-trigger the prefilled modal.
      if (tab || pf) window.history.replaceState({}, '', window.location.pathname)
    } catch { /* malformed param — ignore */ }
  }, [])

  // Month picker in IST (Asia/Kolkata). The DB now buckets clicks/sales by IST
  // month, so the picker values must be IST 'YYYY-MM' or the dashboard would ask
  // for a month the rollup never wrote. formatToParts is locale-proof.
  const monthOptions = useMemo(() => {
    const f  = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
    const iy = Number(f.find(p => p.type === 'year')!.value)
    const im = Number(f.find(p => p.type === 'month')!.value) // 1-based IST month
    return Array.from({ length: 3 }, (_, i) => {
      const d     = new Date(Date.UTC(iy, im - 1 - i, 1)) // pure calendar walk-back
      const val   = d.toISOString().slice(0, 7)           // 'YYYY-MM' (IST month label)
      const label = new Intl.DateTimeFormat('default', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
      return { val, label }
    })
  }, [])
  const [currentMonth, setCurrentMonth] = useState(monthOptions[0].val)

  // Full load — called on mount, visibility change, and when month/campaign deps change
  const load = useCallback(async () => {
    const meRes = await fetch('/api/auth/me')
    if (!meRes.ok) { router.push('/login'); return }
    const me = await meRes.json()
    if (me.status === 'paused' || me.status === 'suspended') { router.push('/paused'); return }
    setUser(me)
    const [metricsRes, feedRes, campRes, reqRes] = await Promise.all([
      fetch(`/api/metrics?clientId=${me.id}&month=${currentMonth}&noCache=1${overviewCampaign ? '&campaignId=' + overviewCampaign : ''}`),
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
  }, [currentMonth, overviewCampaign]) // proper deps — no stale closures

  // Trigger full load on mount and whenever month/campaign deps change
  useEffect(() => { load() }, [load])

  // Visibility change — refresh when user returns to tab
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [load])

  const setupDoneCount = getSetupDoneCount(user?.onboarding)
  const setupLabel     = setupDoneCount === 3 ? 'Setup ✓' : `Setup (${setupDoneCount}/3)`

  const navActions = [
    { label: '+ Campaign', color: 'amber' as const, onClick: () => setShowAddCampaign(true) },
    { label: 'Payouts',    color: 'green' as const, href: '/payouts' },
    { label: setupLabel,   color: 'muted' as const, onClick: () => setShowSetup(true) },
  ]

  const MonthPicker = () => (
    <>
      {monthOptions.map(m => (
        <button key={m.val} onClick={() => setCurrentMonth(m.val)} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${currentMonth === m.val ? 'var(--amber)' : 'var(--border2)'}`, background: currentMonth === m.val ? 'rgba(157,153,255,0.08)' : 'transparent', color: currentMonth === m.val ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontWeight: currentMonth === m.val ? 500 : 400 }}>{m.label}</button>
      ))}
    </>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div className="spinner" style={{ width: 24, height: 24 }} />
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Loading dashboard…</div>
    </div>
  )

  const s        = (metrics?.summary  || {}) as MetricsSummary
  const channels = (metrics?.channels || {}) as Record<string, ChannelData>
  const wa       = (channels.whatsapp || {}) as ChannelData
  const currentMonthLabel = monthOptions.find(m => m.val === currentMonth)?.label || currentMonth

  const clickBars = [
    { label: 'Influencer', value: channels.influencer?.clicks || 0, color: 'var(--amber)' },
    { label: 'SEO',        value: channels.seo?.clicks        || 0, color: 'var(--blue)'  },
    { label: 'Affiliate',  value: channels.affiliate?.clicks  || 0, color: 'var(--green)' },
    { label: 'WhatsApp',   value: wa.clicks                   || 0, color: '#25d366'      },
  ]
  const revBars = [
    { label: 'Influencer', value: Math.round(channels.influencer?.revenue || 0), color: 'var(--amber)' },
    { label: 'SEO',        value: Math.round(channels.seo?.revenue        || 0), color: 'var(--blue)'  },
    { label: 'Affiliate',  value: Math.round(channels.affiliate?.revenue  || 0), color: 'var(--green)' },
    { label: 'WhatsApp',   value: Math.round(wa.revenue                   || 0), color: '#25d366'      },
  ]

  const kpiCell = (label: string, value: string, dim?: string) => (
    <div style={{ padding: '18px 20px', borderRight: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      {dim && <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>{dim}</div>}
    </div>
  )

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <DashboardNav user={user} actions={navActions} brandName={user?.name} onRefresh={load} />
      <ChannelTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {(feed.alerts?.length > 0 || (metrics as any)?.eventsTruncated) && (
        <div style={{ background: 'var(--amber-bg)', borderBottom: '1px solid var(--amber-border)', padding: '9px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--amber)', flex: 1 }}>
            {[
              ...(feed.alerts || []).map((a: any) => a.message),
              ...((metrics as any)?.eventsTruncated ? ['High event volume — analytics capped at 5,000 events this month. Contact support to enable full aggregation.'] : []),
            ].join(' · ')}
          </span>
        </div>
      )}

      {activeTab !== 'overview' && (
        <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginRight: 2 }}>Period:</span>
          <MonthPicker />
        </div>
      )}

      <div style={{ padding: '0 24px' }}>

        {activeTab === 'overview' && (
          <>
            {/* Period + Campaign strip */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', margin: '0 -24px', paddingLeft: 24, paddingRight: 24, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Period:</span>
              <MonthPicker />
              <div style={{ width: '0.5px', height: 16, background: 'var(--border2)', margin: '0 4px' }} />
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Campaign:</span>
              <button onClick={() => setOverviewCampaign('')} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${!overviewCampaign ? 'var(--blue)' : 'var(--border2)'}`, background: 'transparent', color: !overviewCampaign ? 'var(--blue)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>All</button>
              {campaigns.map(camp => (
                <button key={camp.id} onClick={() => setOverviewCampaign(camp.id)} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${overviewCampaign === camp.id ? 'var(--blue)' : 'var(--border2)'}`, background: 'transparent', color: overviewCampaign === camp.id ? 'var(--blue)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>{camp.name}</button>
              ))}
            </div>

            {/* KPI row 1 — 5 cols: clicks, sales, code sales, conv rate, total audience */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '1px solid var(--border)', margin: '0 -24px' }}>
              {kpiCell('Total clicks',    (s.totalClicks||0).toLocaleString('en-IN'))}
              {kpiCell('Total sales',     (s.totalSales ||0).toLocaleString('en-IN'))}
              {kpiCell('Code sales',      (s.codeRedemptions||0).toLocaleString('en-IN'))}
              {kpiCell('Conversion rate', `${s.conversionRate||'0.00'}%`)}
              {kpiCell('Total audience',  universeStats.totalUniverse.toLocaleString('en-IN'), 'unique cookie visitors')}
            </div>

            {/* KPI row 2 — 5 cols: revenue, budget, cost/click, multi-channel, single-channel */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '1px solid var(--border)', margin: '0 -24px' }}>
              {kpiCell('Revenue',        `₹${((s.revenueAttributed||0)/100000).toFixed(1)}L`)}
              {kpiCell('Total budget',   `₹${Math.round((s.totalBudget||0)/1000)}k`)}
              {kpiCell('Cost / click',   s.avgCostPerClick ? `₹${s.avgCostPerClick.toFixed(1)}` : '—')}
              {kpiCell('Multi-channel',  universeStats.totalMultiTouch.toLocaleString('en-IN'), 'touched 2+ partners')}
              {kpiCell('Single-channel', universeStats.totalSingleTouch.toLocaleString('en-IN'), 'one partner only')}
            </div>

            {/* Charts grid */}
            <div style={{ padding: '24px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

              {/* Channel comparison — full width */}
              <div style={{ gridColumn: '1/-1', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 16 }}>Channel comparison — {currentMonthLabel}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                  {[['Influencer','influencer','var(--amber)'],['SEO','seo','var(--blue)'],['Affiliate','affiliate','var(--green)'],['WhatsApp','whatsapp','#25d366']].map(([ch,key,color]) => {
                    const c = (channels[key] || {}) as ChannelData
                    return (
                      <div key={ch} style={{ background: 'var(--surface2)', border: '1px solid var(--border3)', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 11, color, marginBottom: 10, fontWeight: 500 }}>{ch}</div>
                        {(ch === 'WhatsApp'
                          ? [['Sent',c.sent||0],['Read',c.read||0],['Revenue',`₹${((c.revenue||0)/1000).toFixed(0)}k`]]
                          : [['Clicks',c.clicks||0],['Sales',c.sales||0],['Revenue',`₹${((c.revenue||0)/1000).toFixed(0)}k`]]
                        ).map(([l,v]) => (
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

              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Top influencers</div>
                {metrics?.influencers?.length > 0 ? (
                  metrics.influencers.slice(0,5).map((inf: any) => (
                    <div key={inf.influencerId} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, paddingBottom:10, borderBottom:'1px solid var(--border3)' }}>
                      <div>
                        <div style={{ fontSize:12, color:'var(--text-secondary)', fontWeight:500 }}>{inf.name}</div>
                        <div style={{ fontSize:10, color:'var(--text-dim)' }}>{inf.clicks} clicks · {inf.totalSales} sales</div>
                      </div>
                      <div style={{ fontSize:12, color:'var(--amber)' }}>₹{Math.round((inf.revenueAttributed||0)/1000)}k</div>
                    </div>
                  ))
                ) : (
                  <div style={{ textAlign:'center', padding:'20px 0' }}>
                    <div style={{ fontSize:11, color:'var(--text-dim)', marginBottom:8 }}>No influencer data yet</div>
                    <button onClick={() => setActiveTab('influencer')} style={{ border:'1px solid var(--amber)', color:'var(--amber)', background:'transparent', borderRadius:6, padding:'5px 12px', fontSize:11, cursor:'pointer' }}>Add influencer →</button>
                  </div>
                )}
              </div>

              <FeedPanel items={feed.items||[]} alerts={feed.alerts||[]} onRefresh={load} />
              <GoalsPanel goals={user?.goals?.[currentMonth]||{}} clientId={user?.id} month={currentMonth} onUpdated={(g) => setUser((u: any) => ({ ...u, goals: { ...(u?.goals||{}), [currentMonth]: g } }))} />
            </div>

            {/* Reach vs Conv + Audience Overlap — full width below grid */}
            <OverviewAnalytics clientId={user?.id} month={currentMonth} onData={d => setUniverseStats(d.universe)} />
          </>
        )}

        {activeTab === 'analytics' && <AnalyticsDashboard clientId={user?.id} month={currentMonth} />}

        {activeTab === 'influencer' && (
          <div style={{ padding: '24px 0' }}>
            <InfluencerChannelView clientId={user?.id} campaigns={campaigns} baseUrl={baseUrl} month={currentMonth} onCampaignAdd={() => setShowAddCampaign(true)} prefill={influencerPrefill} />
          </div>
        )}

        {activeTab === 'seo' && (
          <div style={{ padding: '24px 0' }}>
            <SEODashboard clientId={user?.id} campaigns={campaigns} baseUrl={baseUrl} month={currentMonth} onCampaignAdd={() => setShowAddCampaign(true)} />
          </div>
        )}

        {activeTab === 'affiliate' && (
          <div style={{ padding: '24px 0' }}>
            <AffiliateDashboard clientId={user?.id} campaigns={campaigns} baseUrl={baseUrl} month={currentMonth} onCampaignAdd={() => setShowAddCampaign(true)} />
          </div>
        )}

        {activeTab === 'whatsapp' && (
          <div style={{ padding: '24px 0' }}>
            <WhatsAppDashboard clientId={user?.id} campaigns={campaigns} baseUrl={baseUrl} month={currentMonth} />
          </div>
        )}

        {activeTab === 'requests' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 16 }}>Partnership requests</div>
            {requests.length === 0 ? (
              <div style={{ textAlign:'center', padding:60, border:'1px dashed var(--border2)', borderRadius:10 }}>
                <div style={{ fontSize:20, marginBottom:8 }}>🤝</div>
                <div style={{ fontSize:13, color:'var(--text-dim)' }}>No pending requests</div>
              </div>
            ) : requests.map((req: any) => (
              <div key={req.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:18, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--text-secondary)', marginBottom:4 }}>{req.agency_name}</div>
                    <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8 }}>Wants to manage: {(req.services||[]).map((s: string)=>s.replace(/_/g,' ')).join(', ')}</div>
                    {req.message && <div style={{ fontSize:12, color:'var(--text-dim)', fontStyle:'italic' }}>{req.message}</div>}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={async () => {
                      const res = await fetch(`/api/agency-requests/${req.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept'})})
                      if (!res.ok) { alert('Failed to accept request. Please try again.'); return }
                      setRequests(prev=>prev.filter(r=>r.id!==req.id))
                    }} style={{ border:'1px solid var(--green)', color:'var(--green)', background:'transparent', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer' }}>Accept</button>
                    <button onClick={async () => {
                      const res = await fetch(`/api/agency-requests/${req.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject'})})
                      if (!res.ok) { alert('Failed to decline request. Please try again.'); return }
                      setRequests(prev=>prev.filter(r=>r.id!==req.id))
                    }} style={{ border:'1px solid var(--red)', color:'var(--red)', background:'transparent', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer' }}>Decline</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'search' && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:24, maxWidth:500 }}>
              <div style={{ fontSize:14, fontWeight:500, color:'var(--text-primary)', marginBottom:8 }}>Google Search Console</div>
              <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:20, lineHeight:1.7 }}>Connect your GSC property to see keyword rankings alongside attribution data.</p>
              <a href="/api/integrations/gsc" style={{ border:'1px solid var(--blue)', color:'var(--blue)', borderRadius:7, padding:'8px 18px', fontSize:13, textDecoration:'none', display:'inline-block' }}>Connect Google Search Console</a>
            </div>
          </div>
        )}

        {activeTab === 'influencer-center' && (
          <div style={{ padding: '24px 0' }}>
            <InfluencerCenter />
          </div>
        )}

        {activeTab === 'market-view' && (
          <div style={{ padding: '24px 0' }}>
            <MarketView />
          </div>
        )}

        {activeTab === 'marketplace' && (
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
        <SetupModal user={user} onClose={() => setShowSetup(false)} onSave={(ob) => setUser((u: any) => ({ ...u, onboarding: ob }))} />
      )}
    </div>
  )
}
