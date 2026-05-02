'use client'
import { useState, useEffect } from 'react'
import AddInfluencerModal from './AddInfluencerModal'
import Modal from './Modal'
import CampaignFilter from './CampaignFilter'
import ChannelStatsBar from './ChannelStatsBar'

interface Influencer { id: string; name: string; handle: string; social_platform: string; fee: number; redirect_slug: string; discount_code?: string; is_active: boolean; campaign_id?: string }
interface Props { clientId: string; campaigns: { id: string; name: string }[]; baseUrl: string; month?: string; onCampaignAdd?: () => void }

const SORT_OPTIONS = [
  { value: 'clicks',  label: 'Clicks' },
  { value: 'sales',   label: 'Sales' },
  { value: 'revenue', label: 'Revenue' },
]

export default function InfluencerChannelView({ clientId, campaigns, baseUrl, month, onCampaignAdd }: Props) {
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [metrics, setMetrics] = useState<Record<string, any>>({})
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [sort, setSort] = useState('clicks')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [statsModal, setStatsModal] = useState<Influencer | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const [infRes, metricsRes] = await Promise.all([
        fetch(`/api/influencers?clientId=${clientId}`),
        fetch(`/api/metrics?month=${month || new Date().toISOString().slice(0,7)}&clientId=${clientId}${selectedCampaign ? `&campaignId=${selectedCampaign}` : ''}`),
      ])
      if (cancelled) return
      const [infData, metricsData] = await Promise.all([infRes.json(), metricsRes.json()])
      setInfluencers(Array.isArray(infData) ? infData : [])
      const map: Record<string, any> = {}
      for (const inf of (metricsData.influencers || [])) map[inf.influencerId] = inf
      setMetrics(map)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [clientId, month, selectedCampaign])

  const toggleActive = async (id: string, current: boolean) => {
    await fetch(`/api/influencers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !current }) })
    setInfluencers(prev => prev.map(i => i.id === id ? { ...i, is_active: !current } : i))
  }

  const deleteInfluencer = async (id: string) => {
    await fetch(`/api/influencers/${id}`, { method: 'DELETE' })
    setInfluencers(prev => prev.filter(i => i.id !== id))
    setDeleteConfirm(null)
  }

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${baseUrl}/r/${slug}`)
    setCopied(slug); setTimeout(() => setCopied(null), 1500)
  }

  const filtered = selectedCampaign ? influencers.filter(i => i.campaign_id === selectedCampaign) : influencers
  const sorted = [...filtered].sort((a, b) => {
    const ma = metrics[a.id] || {}, mb = metrics[b.id] || {}
    if (sort === 'clicks')   return (mb.clicks || 0) - (ma.clicks || 0)
    if (sort === 'sales')    return (mb.totalSales || 0) - (ma.totalSales || 0)
    if (sort === 'revenue')  return (mb.revenueAttributed || 0) - (ma.revenueAttributed || 0)
    return 0
  })

  return (
    <div>
      {/* Channel-specific KPI + charts — reacts to campaign filter */}
      <ChannelStatsBar clientId={clientId} channel="influencer" campaignId={selectedCampaign} month={month} />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <CampaignFilter campaigns={campaigns} selected={selectedCampaign} onChange={setSelectedCampaign} onAdd={onCampaignAdd} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sort:</span>
          {SORT_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setSort(o.value)} style={{ padding: '4px 10px', borderRadius: 5, border: `0.5px solid ${sort === o.value ? 'var(--amber)' : 'var(--border2)'}`, background: 'transparent', color: sort === o.value ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>{o.label}</button>
          ))}
          <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '6px 13px', fontSize: 12, cursor: 'pointer' }}>+ Influencer</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, height: 160 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--border2)', opacity: 0.4 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 12, background: 'var(--border2)', borderRadius: 4, marginBottom: 6, opacity: 0.4, width: '60%' }} />
                  <div style={{ height: 10, background: 'var(--border3)', borderRadius: 4, opacity: 0.3, width: '40%' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {[1,2,3,4].map(j => <div key={j} style={{ height: 30, background: 'var(--border3)', borderRadius: 4, opacity: 0.3 }} />)}
              </div>
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
          <div style={{ fontSize: 20, marginBottom: 10 }}>🎯</div>
          <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>{selectedCampaign ? 'No influencers in this campaign' : 'No influencers yet'}</div>
          <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Add your first influencer</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {sorted.map(inf => {
            const m = metrics[inf.id] || {}
            return (
              <div key={inf.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, opacity: inf.is_active ? 1 : 0.45 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface2)', border: '0.5px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: 'var(--amber)', flexShrink: 0 }}>
                    {inf.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{inf.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{inf.handle} · {inf.social_platform}</div>
                  </div>
                  {!inf.is_active && <span style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 3, padding: '2px 6px', fontSize: 9, color: 'var(--text-dim)' }}>paused</span>}
                </div>

                {/* Per-influencer stats from metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 10 }}>
                  {[
                    ['Clicks',  m.clicks || 0],
                    ['Sales',   m.totalSales || 0],
                    ['Conv',    `${(m.conversionRate||0).toFixed(1)}%`],
                    ['Rev',     `₹${((m.revenueAttributed||0)/1000).toFixed(0)}k`],
                  ].map(([l,v]) => (
                    <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 5, padding: '7px 4px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>

                {/* Code + device breakdown */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  {inf.discount_code && <span className="disc-code">{inf.discount_code}</span>}
                  {m.deviceBreakdown && (
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      📱{m.deviceBreakdown.mobile||0} 🖥{m.deviceBreakdown.desktop||0}
                    </span>
                  )}
                  {m.topCity && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>📍{m.topCity}</span>}
                </div>

                <div style={{ display: 'flex', gap: 6, borderTop: '0.5px solid var(--border3)', paddingTop: 10 }}>
                  <button onClick={() => setStatsModal(inf)} style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}>Full stats</button>
                  <button onClick={() => copyLink(inf.redirect_slug)} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${copied===inf.redirect_slug?'var(--green)':'var(--border2)'}`, color: copied===inf.redirect_slug?'var(--green)':'var(--text-muted)', borderRadius: 5, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}>
                    {copied===inf.redirect_slug ? '✓' : 'Link'}
                  </button>
                  <button onClick={() => toggleActive(inf.id, inf.is_active)} style={{ flex: 1, background: 'transparent', border: `0.5px solid ${inf.is_active?'var(--border2)':'var(--amber)'}`, color: inf.is_active?'var(--text-muted)':'var(--amber)', borderRadius: 5, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}>
                    {inf.is_active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => setDeleteConfirm(inf.id)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 8px', fontSize: 11, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddInfluencerModal clientId={clientId} campaigns={campaigns} onClose={() => setShowAdd(false)} onCreated={inf => { setInfluencers(prev => [inf, ...prev]); setShowAdd(false) }} />}

      {statsModal && (
        <Modal title={`${statsModal.name} — Full stats`} onClose={() => setStatsModal(null)}>
          {(() => {
            const m = metrics[statsModal.id] || {}
            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                  {[['Clicks',m.clicks||0],['Code sales',m.codeRedemptions||0],['Cookie sales',m.cookieSales||0],['Total sales',m.totalSales||0],['Revenue',`₹${(m.revenueAttributed||0).toLocaleString('en-IN')}`],['Conv rate',`${(m.conversionRate||0).toFixed(2)}%`]].map(([l,v]) => (
                    <div key={l as string} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                    </div>
                  ))}
                </div>
                {m.topCity && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Top city: <span style={{ color: 'var(--text-secondary)' }}>{m.topCity}</span></div>}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Fee: <span style={{ color: 'var(--amber)' }}>₹{(statsModal.fee||0).toLocaleString('en-IN')}</span></div>
                {m.deviceBreakdown && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Devices — mobile: {m.deviceBreakdown.mobile||0} · desktop: {m.deviceBreakdown.desktop||0} · tablet: {m.deviceBreakdown.tablet||0}</div>
                )}
              </div>
            )
          })()}
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="Delete influencer?" onClose={() => setDeleteConfirm(null)} width={360}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Removes the influencer and tracking link. Historical events are kept.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setDeleteConfirm(null)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => deleteInfluencer(deleteConfirm)} style={{ background: 'transparent', border: '0.5px solid var(--red)', color: 'var(--red)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}