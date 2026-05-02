'use client'
import { useEffect, useState } from 'react'
import MiniBarChart from './MiniBarChart'
import MiniLineChart from './MiniLineChart'

interface Props {
  clientId: string
  channel: 'influencer' | 'seo' | 'affiliate'
  campaignId?: string
  month?: string
}

const CHANNEL_LABEL = { influencer: 'Influencer', seo: 'SEO & Publications', affiliate: 'Affiliate' }
const CHANNEL_COLOR = { influencer: 'var(--amber)', seo: 'var(--blue)', affiliate: 'var(--green)' }

export default function ChannelStatsBar({ clientId, channel, campaignId, month }: Props) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const m = month || new Date().toISOString().slice(0,7)
      const url = `/api/metrics?clientId=${clientId}&month=${m}${campaignId ? `&campaignId=${campaignId}&noCache=1` : ''}`
      const res = await fetch(url)
      if (cancelled) return
      const data = await res.json()
      setStats(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [clientId, campaignId, month])

  if (loading) {
    return (
      <div style={{ borderBottom: '0.5px solid var(--border)', marginTop: 0, marginRight: '-24px', marginBottom: 0, marginLeft: '-24px', padding: '0' }}>
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

  const c = stats?.channels?.[channel] || {}
  const allClicks    = c.clicks   || 0
  const allSales     = c.sales    || 0
  const allRevenue   = c.revenue  || 0
  const allBudget    = c.budget   || 0
  const convRate     = allClicks > 0 ? ((allSales / allClicks) * 100).toFixed(2) : '0.00'
  const cpc          = allClicks > 0 && allBudget > 0 ? (allBudget / allClicks).toFixed(1) : null
  const cps          = allSales  > 0 && allBudget > 0 ? (allBudget / allSales).toFixed(0)  : null

  // Per-entity breakdown for bar chart
  let barData: { label: string; value: number }[] = []
  if (channel === 'influencer') {
    barData = (stats?.influencers || []).slice(0, 5).map((i: any) => ({ label: i.handle || i.name?.split(' ')[0], value: i.clicks || 0 }))
  }

  // Build KPI cells
  const kpis = [
    { label: 'Clicks',          value: allClicks.toLocaleString('en-IN') },
    { label: 'Sales',           value: allSales.toLocaleString('en-IN') },
    { label: 'Revenue',         value: `₹${(allRevenue / 100000).toFixed(1)}L` },
    { label: 'Conv rate',       value: `${convRate}%` },
    ...(allBudget > 0
      ? [{ label: channel === 'seo' ? 'Total cost' : 'Total budget', value: `₹${(allBudget / 1000).toFixed(0)}k` }]
      : []),
    ...(cpc ? [{ label: 'Cost / click', value: `₹${cpc}` }] : []),
    ...(cps ? [{ label: 'Cost / sale',  value: `₹${cps}` }] : []),
  ].slice(0, 5)

  const color = CHANNEL_COLOR[channel]

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)', marginTop: 0, marginRight: '-24px', marginBottom: 20, marginLeft: '-24px' }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
        {kpis.map((k, i) => (
          <div key={k.label} style={{ padding: '16px 22px', borderRight: i < kpis.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 7 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Mini charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: '14px 24px', borderTop: '0.5px solid var(--border)' }}>
        {/* Clicks vs Sales comparison */}
        <MiniBarChart
          title={`${CHANNEL_LABEL[channel]} performance`}
          bars={[
            { label: 'Clicks',  value: allClicks, color },
            { label: 'Sales',   value: allSales,  color: 'var(--green)' },
          ]}
          emptyMessage="No data yet — add tracking links"
          height={80}
        />

        {/* Revenue chart */}
        <MiniBarChart
          title="Revenue"
          bars={allRevenue > 0 ? [
            { label: 'Revenue',  value: Math.round(allRevenue), color },
            { label: 'Budget',   value: Math.round(allBudget),  color: 'var(--text-dim)' },
          ] : []}
          emptyMessage="No revenue attributed yet"
          height={80}
        />

        {/* Top entities bar */}
        {channel === 'influencer' ? (
          <MiniBarChart
            title="Clicks by influencer"
            bars={barData.length > 0 ? barData.map(b => ({ ...b, color })) : []}
            emptyMessage="No influencer data"
            height={80}
          />
        ) : channel === 'seo' ? (
          <div className="chart-container">
            <div className="chart-title">Cost efficiency</div>
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
          <div className="chart-container">
            <div className="chart-title">Commission summary</div>
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