'use client'
import { useEffect, useState } from 'react'
import MiniBarChart from './MiniBarChart'
import MiniLineChart from './MiniLineChart'

interface ChannelData {
  clicks: number; sales: number; revenue: number; budget: number
  codeRedemptions?: number; avgCostPerClick?: number
}

interface Props {
  clientId: string
  channel: 'influencer' | 'seo' | 'affiliate'
  campaignId?: string
  month?: string
}

const CHANNEL_LABEL = { influencer: 'Influencer', seo: 'SEO & Publications', affiliate: 'Affiliate' }
const CHANNEL_COLOR = { influencer: 'var(--amber)', seo: '#4a9eff', affiliate: '#2ecc71' }

export default function ChannelStatsBar({ clientId, channel, campaignId, month }: Props) {
  const [stats, setStats]       = useState<any>(null)
  const [visitors, setVisitors] = useState<any>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const m      = month || new Date().toISOString().slice(0, 7)
      const url    = `/api/metrics?clientId=${clientId}&month=${m}&noCache=1${campaignId ? `&campaignId=${campaignId}` : ''}`
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

  const c          = (stats?.channels?.[channel] || {}) as ChannelData
  const allClicks  = c.clicks  || 0
  const allSales   = c.sales   || 0
  const allRevenue = c.revenue || 0
  const allBudget  = c.budget  || 0
  const codeSales  = c.codeRedemptions || 0
  const convRate   = allClicks > 0 ? ((allSales / allClicks) * 100).toFixed(2) : '0.00'
  const cpc        = c.avgCostPerClick || (allClicks > 0 && allBudget > 0 ? (allBudget / allClicks) : null)
  const cps        = allSales  > 0 && allBudget > 0 ? (allBudget / allSales).toFixed(0)  : null

  // Visitor stats
  const unique      = visitors?.totalUnique   || 0
  const returned    = visitors?.totalReturned || 0
  const shared      = visitors?.totalShared   || 0
  const returnRate  = visitors?.returnRate    || 0
  const sharedRate  = visitors?.sharedRate    || 0

  // Bar chart data for influencer tab
  const barData = channel === 'influencer'
    ? (stats?.influencers || []).slice(0, 5).map((i: any) => ({
        label: i.handle || i.name?.split(' ')[0],
        value: i.clicks || 0,
        color,
      }))
    : []

  const kpiCell = (label: string, value: string | number, col?: string, dim?: string) => (
    <div key={label} style={{ padding: '14px 18px', borderRight: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color: col || 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      {dim && <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>{dim}</div>}
    </div>
  )

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)', margin: '0 -24px', marginBottom: 20 }}>

      {/* KPI row 1 — performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '0.5px solid var(--border3)' }}>
        {kpiCell('Clicks',     allClicks.toLocaleString('en-IN'))}
        {kpiCell('Sales',      allSales.toLocaleString('en-IN'))}
        {kpiCell('Code sales', codeSales.toLocaleString('en-IN'))}
        {kpiCell('Revenue',    `₹${Math.round(allRevenue / 1000)}k`, color)}
        {kpiCell('Conv rate',  `${convRate}%`)}
      </div>

      {/* KPI row 2 — budget + visitor stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '0.5px solid var(--border3)' }}>
        {kpiCell(channel === 'seo' ? 'Total cost' : 'Total budget',
          allBudget > 0 ? `₹${Math.round(allBudget / 1000)}k` : '—')}
        {kpiCell('Cost / click', cpc ? `₹${Number(cpc).toFixed(1)}` : '—')}
        {kpiCell('Unique visitors', unique.toLocaleString('en-IN'), 'var(--amber)',
          unique === 0 ? 'install beacon' : undefined)}
        {kpiCell('Returned', returned.toLocaleString('en-IN'), '#4a9eff',
          returnRate > 0 ? `${returnRate}% rate` : undefined)}
        {kpiCell('Shared', shared.toLocaleString('en-IN'), '#9b59b6',
          sharedRate > 0 ? `${sharedRate}% rate` : undefined)}
      </div>

      {/* Charts row — same 3 charts as before */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: '14px 24px', borderTop: '0.5px solid var(--border3)' }}>

        {/* Chart 1 — Clicks vs Sales */}
        <MiniBarChart
          title={`${CHANNEL_LABEL[channel]} performance`}
          bars={[
            { label: 'Clicks', value: allClicks, color },
            { label: 'Sales',  value: allSales,  color: 'var(--green)' },
          ]}
          emptyMessage="No data yet — add tracking links"
          height={80}
        />

        {/* Chart 2 — Revenue vs Budget */}
        <MiniBarChart
          title="Revenue"
          bars={allRevenue > 0 ? [
            { label: 'Revenue', value: Math.round(allRevenue), color },
            { label: 'Budget',  value: Math.round(allBudget),  color: 'var(--text-dim)' },
          ] : []}
          emptyMessage="No revenue attributed yet"
          height={80}
        />

        {/* Chart 3 — channel specific */}
        {channel === 'influencer' ? (
          <MiniBarChart
            title="Clicks by influencer"
            bars={barData.length > 0 ? barData : []}
            emptyMessage="No influencer data"
            height={80}
          />
        ) : channel === 'seo' ? (
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Cost efficiency</div>
            {cpc ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Cost / click</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color }}>₹{cpc}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Cost / sale</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--green)' }}>₹{cps || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Conv rate</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{convRate}%</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', paddingTop: 16, textAlign: 'center' }}>Set cost on publications to see efficiency</div>
            )}
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 14 }}>Commission summary</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
              {allSales > 0 ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sales attributed</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color }}>{allSales}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Revenue attributed</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--green)' }}>₹{(allRevenue / 1000).toFixed(0)}k</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Conv rate</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{convRate}%</span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', paddingTop: 16, textAlign: 'center' }}>No affiliate sales yet</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}