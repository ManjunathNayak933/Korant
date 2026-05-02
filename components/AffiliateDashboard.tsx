'use client'
import { useState, useEffect } from 'react'
import AddAffiliateModal from './AddAffiliateModal'
import Modal from './Modal'
import CampaignFilter from './CampaignFilter'
import ChannelStatsBar from './ChannelStatsBar'
import MiniBarChart from './MiniBarChart'
import { FormField, Textarea, SubmitButton } from './FormFields'

interface Affiliate { id: string; name: string; handle: string; email?: string; phone?: string; is_active: boolean; paused_at?: string; paused_reason?: string; source: string; redirect_slug: string; discount_code?: string; commission_type: string; commission_value: number; commission_trigger: string; created_at: string; campaign_id?: string }
interface Program { id: string; name: string; commission_type: string; commission_value: number; commission_trigger: string; attribution_window_days: number; is_public: boolean; is_active: boolean }
interface AffStats { clicks: number; sales: number; revenue: number; commission: number }
interface Props { clientId: string; campaigns: { id: string; name: string }[]; baseUrl: string; month?: string; onCampaignAdd?: () => void }

type SortKey = 'clicks' | 'sales' | 'revenue' | 'commission'

export default function AffiliateDashboard({ clientId, campaigns, baseUrl, month, onCampaignAdd }: Props) {
  const [subTab, setSubTab] = useState<'affiliates' | 'programs' | 'ambassadors'>('affiliates')
  const [affiliates, setAffiliates] = useState<Affiliate[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [allMetrics, setAllMetrics] = useState<any>(null)
  const [affStats, setAffStats] = useState<Record<string, AffStats>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [pauseModal, setPauseModal] = useState<Affiliate | null>(null)
  const [pauseReason, setPauseReason] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [sort, setSort] = useState<SortKey>('clicks')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const url = selectedCampaign
        ? `/api/metrics?clientId=${clientId}&month=${month || new Date().toISOString().slice(0,7)}&campaignId=${selectedCampaign}`
        : `/api/metrics?clientId=${clientId}&month=${month || new Date().toISOString().slice(0,7)}`
      const [affRes, progRes, metricsRes] = await Promise.all([
        fetch(`/api/affiliates?clientId=${clientId}`),
        fetch(`/api/affiliate-programs?clientId=${clientId}`),
        fetch(url),
      ])
      if (cancelled) return
      const [affData, progData, metricsData] = await Promise.all([affRes.json(), progRes.json(), metricsRes.json()])
      setAffiliates(Array.isArray(affData) ? affData : [])
      setPrograms(Array.isArray(progData) ? progData : [])
      setAllMetrics(metricsData)
      // Build per-affiliate stats from raw events
      const map: Record<string, AffStats> = {}
      for (const e of (metricsData.rawEvents || metricsData.events || [])) {
        if (!e?.affiliate_id) continue
        if (!map[e.affiliate_id]) map[e.affiliate_id] = { clicks: 0, sales: 0, revenue: 0, commission: 0 }
        if (e.type === 'click') map[e.affiliate_id].clicks++
        else {
          map[e.affiliate_id].sales++
          map[e.affiliate_id].revenue += e.order_value || 0
          map[e.affiliate_id].commission += e.commission_amount || 0
        }
      }
      setAffStats(map)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [clientId, month, selectedCampaign])

  const pause = async () => {
    if (!pauseModal) return
    await fetch(`/api/affiliates/${pauseModal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: false, paused_reason: pauseReason }) })
    setAffiliates(prev => prev.map(a => a.id === pauseModal.id ? { ...a, is_active: false, paused_at: new Date().toISOString(), paused_reason: pauseReason } : a))
    setPauseModal(null); setPauseReason('')
  }

  const resume = async (id: string) => {
    await fetch(`/api/affiliates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: true }) })
    setAffiliates(prev => prev.map(a => a.id === id ? { ...a, is_active: true, paused_at: undefined } : a))
  }

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${baseUrl}/r/${slug}`)
    setCopied(slug); setTimeout(() => setCopied(null), 1500)
  }

  const regularAffiliates = affiliates.filter(a => a.source !== 'public_signup')
  const ambassadors = affiliates.filter(a => a.source === 'public_signup')

  const filteredRegular = selectedCampaign
    ? regularAffiliates.filter(a => a.campaign_id === selectedCampaign)
    : regularAffiliates

  const sortedRegular = [...filteredRegular].sort((a, b) => {
    const sa = affStats[a.id] || { clicks: 0, sales: 0, revenue: 0, commission: 0 }
    const sb = affStats[b.id] || { clicks: 0, sales: 0, revenue: 0, commission: 0 }
    if (sort === 'clicks')     return sb.clicks - sa.clicks
    if (sort === 'sales')      return sb.sales - sa.sales
    if (sort === 'revenue')    return sb.revenue - sa.revenue
    if (sort === 'commission') return sb.commission - sa.commission
    return 0
  })

  const filteredAmbassadors = statusFilter === 'all' ? ambassadors : ambassadors.filter(a => statusFilter === 'active' ? a.is_active : !a.is_active)

  // Channel KPIs
  const ch = allMetrics?.channels?.affiliate || {}
  const totalClicks = ch.clicks || 0
  const totalSales = ch.sales || 0
  const totalRevenue = ch.revenue || 0
  const totalCommission = Object.values(affStats).reduce((s, v) => s + v.commission, 0)
  const convRate = totalClicks > 0 ? ((totalSales / totalClicks) * 100).toFixed(2) : '0.00'

  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'clicks',     label: 'Clicks' },
    { value: 'sales',      label: 'Sales' },
    { value: 'revenue',    label: 'Revenue' },
    { value: 'commission', label: 'Commission' },
  ]

  const topBars = sortedRegular.slice(0, 6).map(aff => ({
    label: aff.handle.replace('@', '').slice(0, 8),
    value: sort === 'revenue'    ? Math.round(affStats[aff.id]?.revenue || 0)
         : sort === 'sales'      ? (affStats[aff.id]?.sales || 0)
         : sort === 'commission' ? Math.round(affStats[aff.id]?.commission || 0)
         : (affStats[aff.id]?.clicks || 0),
    color: 'var(--green)',
  }))

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: 20 }}>
        {[
          ['affiliates',  `Affiliates (${regularAffiliates.length})`],
          ['programs',    `Programs (${programs.length})`],
          ['ambassadors', `Ambassadors (${ambassadors.length})`],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id as any)} style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${subTab === id ? 'var(--amber)' : 'transparent'}`, color: subTab === id ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {/* Channel KPI + charts — reacts to campaign filter */}
      {subTab === 'affiliates' && <ChannelStatsBar clientId={clientId} channel="affiliate" campaignId={selectedCampaign} month={month} />}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 120, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, opacity: 0.4 }} />)}
        </div>
      ) : (
        <>
          {/* ─── AFFILIATES ─── */}
          {subTab === 'affiliates' && (
            <div>
              {/* Controls */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <CampaignFilter campaigns={campaigns} selected={selectedCampaign} onChange={setSelectedCampaign} onAdd={onCampaignAdd} />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sort:</span>
                    {SORT_OPTIONS.map(o => (
                      <button key={o.value} onClick={() => setSort(o.value)} style={{ padding: '4px 10px', borderRadius: 5, border: `0.5px solid ${sort === o.value ? 'var(--green)' : 'var(--border2)'}`, background: 'transparent', color: sort === o.value ? 'var(--green)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>{o.label}</button>
                    ))}
                  </div>
                </div>
                <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '6px 13px', fontSize: 12, cursor: 'pointer' }}>+ Affiliate</button>
              </div>

              {/* Cards */}
              {sortedRegular.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 20, marginBottom: 10 }}>🔗</div>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>{selectedCampaign ? 'No affiliates in this campaign' : 'No affiliates yet'}</div>
                  <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Add first affiliate</button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
                  {sortedRegular.map(aff => {
                    const st = affStats[aff.id] || { clicks: 0, sales: 0, revenue: 0, commission: 0 }
                    return (
                      <div key={aff.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, opacity: aff.is_active ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface2)', border: '0.5px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: 'var(--green)', flexShrink: 0 }}>
                            {aff.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{aff.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{aff.handle}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: 'var(--green)' }}>{aff.commission_value}{aff.commission_type === 'percentage' ? '%' : '₹'}</div>
                            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{aff.commission_trigger.replace('_', ' ')}</div>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
                          {[
                            ['Clicks',  st.clicks],
                            ['Sales',   st.sales],
                            ['Rev',     `₹${(st.revenue/1000).toFixed(0)}k`],
                            ['Comm',    `₹${st.commission.toFixed(0)}`],
                          ].map(([l, v]) => (
                            <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: '5px 4px' }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                            </div>
                          ))}
                        </div>
                        {aff.discount_code && <div style={{ marginBottom: 10 }}><span className="disc-code">{aff.discount_code}</span></div>}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => copyLink(aff.redirect_slug)} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${copied === aff.redirect_slug ? 'var(--green)' : 'var(--border2)'}`, color: copied === aff.redirect_slug ? 'var(--green)' : 'var(--text-muted)', borderRadius: 5, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}>
                            {copied === aff.redirect_slug ? '✓' : 'Copy link'}
                          </button>
                          <button onClick={() => aff.is_active ? setPauseModal(aff) : resume(aff.id)} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${aff.is_active ? 'var(--border2)' : 'var(--amber)'}`, color: aff.is_active ? 'var(--text-muted)' : 'var(--amber)', borderRadius: 5, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}>
                            {aff.is_active ? 'Pause' : 'Resume'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {showAdd && <AddAffiliateModal clientId={clientId} programs={programs} campaigns={campaigns} onClose={() => setShowAdd(false)} onCreated={a => setAffiliates(prev => [a, ...prev])} />}
            </div>
          )}

          {/* ─── PROGRAMS ─── */}
          {subTab === 'programs' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                <button onClick={async () => {
                  const name = prompt('Program name?'); if (!name) return
                  const val = prompt('Commission % (e.g. 10)?'); if (!val) return
                  const res = await fetch('/api/affiliate-programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, name, commission_value: parseFloat(val), commission_type: 'percentage' }) })
                  const p = await res.json(); if (res.ok) setPrograms(prev => [p, ...prev])
                }} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '6px 13px', fontSize: 12, cursor: 'pointer' }}>+ Program</button>
              </div>
              {programs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No programs yet. Create one to define commission structures for affiliates.</div>
                </div>
              ) : programs.map(prog => (
                <div key={prog.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>{prog.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{prog.commission_value}{prog.commission_type === 'percentage' ? '%' : '₹'} · {prog.commission_trigger.replace('_', ' ')} · {prog.attribution_window_days}d window · {affiliates.filter(a => (a as any).program_id === prog.id).length} affiliates</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={async () => { await fetch(`/api/affiliate-programs/${prog.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_public: !prog.is_public }) }); setPrograms(prev => prev.map(p => p.id === prog.id ? { ...p, is_public: !prog.is_public } : p)) }} style={{ border: `0.5px solid ${prog.is_public ? 'var(--green)' : 'var(--border2)'}`, color: prog.is_public ? 'var(--green)' : 'var(--text-muted)', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                      {prog.is_public ? '● Public' : '○ Private'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ─── AMBASSADORS ─── */}
          {subTab === 'ambassadors' && (
            <div>
              {/* KPI strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: '0.5px solid var(--border)', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
                {[
                  { label: 'Total',  value: ambassadors.length,                         color: 'var(--text-primary)' },
                  { label: 'Active', value: ambassadors.filter(a => a.is_active).length, color: 'var(--green)' },
                  { label: 'Paused', value: ambassadors.filter(a => !a.is_active).length,color: 'var(--amber)' },
                ].map((k, i) => (
                  <div key={k.label} style={{ padding: '14px 16px', background: 'var(--surface)', borderRight: i < 2 ? '0.5px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 6 }}>{k.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 500, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['all', 'active', 'paused'].map(f => (
                    <button key={f} onClick={() => setStatusFilter(f)} style={{ padding: '4px 12px', borderRadius: 5, border: `0.5px solid ${statusFilter === f ? 'var(--amber)' : 'var(--border2)'}`, color: statusFilter === f ? 'var(--amber)' : 'var(--text-muted)', background: 'transparent', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
                  ))}
                </div>
                <button onClick={() => window.open(`/api/export?type=ambassadors&clientId=${clientId}`, '_blank')} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>↓ Export CSV</button>
              </div>
              {filteredAmbassadors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No ambassadors {statusFilter !== 'all' ? `(${statusFilter})` : 'yet'}</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Name','Handle','Email','Joined','Status','Actions'].map(h => <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', padding: '8px 12px', textAlign: 'left', borderBottom: '0.5px solid var(--border3)', fontWeight: 400 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {filteredAmbassadors.map(aff => (
                      <tr key={aff.id}>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>{aff.name}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>{aff.handle}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>{aff.email || '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-dim)', padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>{new Date(aff.created_at).toLocaleDateString('en-IN')}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>
                          <span style={{ background: aff.is_active ? 'var(--green-bg)' : 'var(--amber-bg)', border: `0.5px solid ${aff.is_active ? 'var(--green-border)' : 'var(--amber-border)'}`, borderRadius: 4, padding: '2px 7px', fontSize: 10, color: aff.is_active ? 'var(--green)' : 'var(--amber)' }}>{aff.is_active ? 'Active' : 'Paused'}</span>
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>
                          {aff.is_active
                            ? <button onClick={() => setPauseModal(aff)} style={{ background: 'transparent', border: '0.5px solid var(--amber)', color: 'var(--amber)', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Pause</button>
                            : <button onClick={() => resume(aff.id)} style={{ background: 'transparent', border: '0.5px solid var(--green)', color: 'var(--green)', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Resume</button>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {pauseModal && (
        <Modal title={`Pause ${pauseModal.name}?`} onClose={() => setPauseModal(null)} width={380}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Their link still works but clicks and sales won't be tracked.</p>
          <FormField label="Reason (internal, optional)">
            <Textarea value={pauseReason} onChange={e => setPauseReason(e.target.value)} placeholder="e.g. Account inactive…" />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setPauseModal(null)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={pause} style={{ background: 'transparent', border: '0.5px solid var(--amber)', color: 'var(--amber)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Pause</button>
          </div>
        </Modal>
      )}
    </div>
  )
}