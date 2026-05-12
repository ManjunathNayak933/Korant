'use client'
import { useEffect, useState } from 'react'
import MiniBarChart from './MiniBarChart'

interface Props {
  clientId: string
  channel: 'influencer' | 'seo' | 'affiliate'
  campaignId?: string
  month?: string
}

const CHANNEL_LABEL = { influencer: 'Influencer', seo: 'SEO & Publications', affiliate: 'Affiliate' }
const CHANNEL_COLOR = { influencer: 'var(--amber)', seo: '#4a9eff', affiliate: '#2ecc71' }

export default function ChannelStatsBar({ clientId, channel, campaignId, month }: Props) {
  const [stats, setStats]     = useState<any>(null)
  const [visitors, setVisitors] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const m   = month || new Date().toISOString().slice(0, 7)
      const url = `/api/metrics?clientId=${clientId}&month=${m}${campaignId ? `&campaignId=${campaignId}&noCache=1` : ''}`
      const visUrl = `/api/analytics/asset-stats?clientId=${clientId}&month=${m}&channel=${channel}`

      const [metricsRes, visRes] = await Promise.allSettled([fetch(url), fetch(visUrl)])
      if (cancelled) return

      if (metricsRes.status === 'fulfilled') {
        const data = await metricsRes.value.json()
        setStats(data)
      }
      if (visRes.status === 'fulfilled') {
        const vdata = await visRes.value.json()
        setVisitors(vdata?.channelSummary || null)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [clientId, campaignId, month])

  const color = CHANNEL_COLOR[channel]

  if (loading) {
    return (
      <div style={{ borderBottom: '0.5px solid var(--border)', margin: '0 -24px', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)' }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ padding: '16px 22px', borderRight: '0.5px solid var(--border)' }}>
              <div style={{ height: 10, background: 'var(--border2)', borderRadius: 3, width: '60%', marginBottom: 10, opacity: 0.4 }} />
              <div style={{ height: 22, background: 'var(--border3)', borderRadius: 3, width: '45%', opacity: 0.3 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const c        = stats?.channels?.[channel] || {}
  const allClicks  = c.clicks  || 0
  const allSales   = c.sales   || 0
  const allRevenue = c.revenue || 0
  const allBudget  = c.budget  || 0
  const codeSales  = stats?.summary?.codeRedemptions || 0
  const convRate   = allClicks > 0 ? ((allSales / allClicks) * 100).toFixed(2) : '0.00'
  const cpc        = allClicks > 0 && allBudget > 0 ? (allBudget / allClicks).toFixed(1) : null

  // Visitor stats (from asset-stats API — requires beacon)
  const unique   = visitors?.totalUnique   || 0
  const returned = visitors?.totalReturned || 0
  const shared   = visitors?.totalShared   || 0
  const returnRate = visitors?.returnRate  || 0
  const sharedRate = visitors?.sharedRate  || 0

  const kpiCell = (label: string, value: string | number, col?: string, dim?: string) => (
    <div key={label} style={{ padding: '14px 18px', borderRight: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: col || 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      {dim && <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>{dim}</div>}
    </div>
  )

  // Bar chart for influencer clicks
  const barData = channel === 'influencer'
    ? (stats?.influencers || []).slice(0, 5).map((i: any) => ({ label: i.handle || i.name?.split(' ')[0], value: i.clicks || 0, color }))
    : []

  return (
    <div style={{ margin: '0 -24px', marginBottom: 20, borderBottom: '0.5px solid var(--border)' }}>
      {/* Row 1 — performance KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '0.5px solid var(--border3)' }}>
        {kpiCell('Clicks',      allClicks.toLocaleString('en-IN'))}
        {kpiCell('Sales',       allSales.toLocaleString('en-IN'))}
        {kpiCell('Code sales',  codeSales.toLocaleString('en-IN'))}
        {kpiCell('Revenue',     `₹${(allRevenue / 100000).toFixed(1)}L`, color)}
        {kpiCell('Conv rate',   `${convRate}%`)}
      </div>

      {/* Row 2 — budget + visitor KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)' }}>
        {kpiCell(
          channel === 'seo' ? 'Total cost' : 'Total budget',
          allBudget > 0 ? `₹${(allBudget / 1000).toFixed(0)}k` : '—'
        )}
        {kpiCell('Cost / click', cpc ? `₹${cpc}` : '—')}
        {kpiCell('Unique visitors', unique.toLocaleString('en-IN'), 'var(--amber)',
          unique === 0 ? 'install beacon' : undefined)}
        {kpiCell('Returned',   returned.toLocaleString('en-IN'), '#4a9eff',
          returnRate > 0 ? `${returnRate}% rate` : undefined)}
        {kpiCell('Shared',     shared.toLocaleString('en-IN'), '#9b59b6',
          sharedRate > 0 ? `${sharedRate}% rate` : undefined)}
      </div>
    </div>
  )
}