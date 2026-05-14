'use client'
import { useState, useEffect } from 'react'
import AddPublicationModal from './AddPublicationModal'
import Modal from './Modal'
import CampaignFilter from './CampaignFilter'
import ChannelStatsBar from './ChannelStatsBar'
import AssetInsights, { useAssetData } from './AssetInsights'

interface Pub { id: string; publication_name: string; author_name?: string; type: string; article_url?: string; redirect_slug: string; destination_url: string; estimated_reach?: number; is_sponsored: boolean; published_at?: string; cost: number; is_active: boolean; campaign_id?: string }
interface PubStats { clicks: number; sales: number; revenue: number; codeRedemptions?: number }
interface Props { clientId: string; campaigns: { id: string; name: string }[]; baseUrl: string; month?: string; onCampaignAdd?: () => void }

export default function SEODashboard({ clientId, campaigns, baseUrl, month, onCampaignAdd }: Props) {
  const [pubs, setPubs]           = useState<Pub[]>([])
  const [loading, setLoading]     = useState(true)
  const [showAdd, setShowAdd]     = useState(false)
  const [statsModal, setStatsModal] = useState<Pub | null>(null)
  const [eventMap, setEventMap]   = useState<Record<string, PubStats>>({})
  const [copied, setCopied]       = useState<string | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState('')

  // Visitor stats per publication
  const { data: assetData } = useAssetData(clientId, month, 'seo')
  const visitorMap: Record<string, { unique: number; returned: number; shared: number; returnRate: number; sharedRate: number }> = {}
  ;(assetData?.partnerStats || []).forEach(p => { visitorMap[p.id] = p })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const [pubRes, metricsRes] = await Promise.all([
        fetch(`/api/publications?clientId=${clientId}`),
        fetch(`/api/metrics?month=${month || new Date().toISOString().slice(0,7)}&clientId=${clientId}${selectedCampaign ? `&campaignId=${selectedCampaign}` : ''}`),
      ])
      if (cancelled) return
      const [pubData, metricsData] = await Promise.all([pubRes.json(), metricsRes.json()])
      setPubs(Array.isArray(pubData) ? pubData : [])
      // Build per-publication stats map from server-computed publications array
      const map: Record<string, PubStats> = {}
      for (const pub of (metricsData.publications || [])) {
        map[pub.publicationId] = { clicks: pub.clicks || 0, sales: pub.sales || 0, revenue: pub.revenue || 0, codeRedemptions: pub.codeRedemptions || 0 }
      }
      setEventMap(map)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [clientId, month, selectedCampaign])

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${baseUrl}/r/${slug}`)
    setCopied(slug); setTimeout(() => setCopied(null), 1500)
  }

  const toggleActive = async (id: string, current: boolean) => {
    const res = await fetch(`/api/publications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !current }) })
    if (!res.ok) { alert('Failed to update publication status. Please try again.'); return }
    setPubs(prev => prev.map(p => p.id === id ? { ...p, is_active: !current } : p))
  }

  const filtered = selectedCampaign ? pubs.filter(p => p.campaign_id === selectedCampaign) : pubs

  return (
    <div>
      <ChannelStatsBar clientId={clientId} channel="seo" campaignId={selectedCampaign} month={month} />
      <AssetInsights clientId={clientId} month={month} channel="seo" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <CampaignFilter campaigns={campaigns} selected={selectedCampaign} onChange={setSelectedCampaign} onAdd={onCampaignAdd} />
        <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--blue)', color: 'var(--blue)', background: 'transparent', borderRadius: 7, padding: '6px 13px', fontSize: 12, cursor: 'pointer' }}>+ Publication</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 100, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, opacity: 0.5 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
          <div style={{ fontSize: 20, marginBottom: 10 }}>📄</div>
          <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>{selectedCampaign ? 'No publications in this campaign' : 'No publications yet'}</div>
          <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--blue)', color: 'var(--blue)', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Add first placement</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(pub => {
            const st = (eventMap[pub.id] || { clicks: 0, sales: 0, revenue: 0, codeRedemptions: 0 }) as PubStats
            const v  = visitorMap[pub.id]
            const cpc  = st.clicks > 0 && pub.cost > 0 ? pub.cost / st.clicks : null
            const conv = st.clicks > 0 ? (st.sales / st.clicks * 100) : 0
            return (
              <div key={pub.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, opacity: pub.is_active ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 3 }}>
                      {pub.publication_name}
                      {pub.is_sponsored && <span style={{ background: 'var(--amber-bg)', border: '0.5px solid var(--amber-border)', borderRadius: 3, padding: '1px 5px', fontSize: 9, color: 'var(--amber)', marginLeft: 6 }}>sponsored</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{pub.author_name || 'Unknown author'} · {pub.type} · {pub.published_at || 'No date'}</div>
                  </div>
                  {pub.cost > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>₹{pub.cost.toLocaleString('en-IN')}</span>}
                </div>

                {/* Row 1 — performance stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginBottom: 6 }}>
                  {[
                    ['Clicks',  st.clicks],
                    ['Sales',   st.sales],
                    ['Conv',    `${conv.toFixed(1)}%`],
                    ['CPC',     cpc ? `₹${cpc.toFixed(0)}` : '—'],
                    ['Revenue', `₹${(st.revenue/1000).toFixed(0)}k`],
                  ].map(([l,val]) => (
                    <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 5, padding: '6px 4px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{val}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>

                {/* Row 2 — visitor stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 12 }}>
                  {[
                    ['Unique',   v?.unique   ?? '—', 'var(--amber)'],
                    ['Returned', v?.returned ?? '—', '#4a9eff'],
                    ['Shared',   v?.shared   ?? '—', '#9b59b6'],
                  ].map(([l, val, col]) => (
                    <div key={l as string} style={{ textAlign: 'center', background: `${col}11`, border: `0.5px solid ${col}33`, borderRadius: 5, padding: '5px 4px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: col as string }}>{val}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 1 }}>{l}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setStatsModal(pub)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>Full stats</button>
                  <button onClick={() => copyLink(pub.redirect_slug)} style={{ background: 'transparent', border: `0.5px solid ${copied === pub.redirect_slug ? 'var(--green)' : 'var(--border2)'}`, color: copied === pub.redirect_slug ? 'var(--green)' : 'var(--text-muted)', borderRadius: 5, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                    {copied === pub.redirect_slug ? '✓ Copied' : 'Copy link'}
                  </button>
                  {pub.article_url && <a href={pub.article_url} target="_blank" rel="noopener noreferrer" style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 12px', fontSize: 11, textDecoration: 'none' }}>View ↗</a>}
                  <button onClick={() => toggleActive(pub.id, pub.is_active)} style={{ border: `0.5px solid ${pub.is_active ? 'var(--border2)' : 'var(--blue)'}`, color: pub.is_active ? 'var(--text-muted)' : 'var(--blue)', background: 'transparent', borderRadius: 5, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                    {pub.is_active ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Full Stats Modal */}
      {statsModal && (() => {
        const st = (eventMap[statsModal.id] || { clicks: 0, sales: 0, revenue: 0, codeRedemptions: 0 }) as PubStats
        const v  = visitorMap[statsModal.id]
        const cpc  = st.clicks > 0 && statsModal.cost > 0 ? statsModal.cost / st.clicks : null
        const conv = st.clicks > 0 ? (st.sales / st.clicks * 100) : 0
        return (
          <Modal title={`${statsModal.publication_name} — Full stats`} onClose={() => setStatsModal(null)}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 8 }}>Performance</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
              {[['Clicks',st.clicks],['Sales',st.sales],['Conv rate',`${conv.toFixed(2)}%`],['CPC',cpc?`₹${cpc.toFixed(0)}`:'—'],['Revenue',`₹${st.revenue.toLocaleString('en-IN')}`],['Cost',`₹${statsModal.cost.toLocaleString('en-IN')}`]].map(([l,v]) => (
                <div key={l as string} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 8 }}>Visitor breakdown</div>
            {v ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 10 }}>
                  {[['Unique visitors',v.unique,'var(--amber)'],['Returned',v.returned,'#4a9eff'],['Shared*',v.shared,'#9b59b6']].map(([l,val,col]) => (
                    <div key={l as string} style={{ background: `${col}11`, border: `0.5px solid ${col}33`, borderRadius: 6, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 600, color: col as string }}>{val}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  {[['Return rate',`${v.returnRate}%`,'#4a9eff'],['Shared rate',`${v.sharedRate}%`,'#9b59b6']].map(([l,val,col]) => (
                    <div key={l as string} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 500, color: col }}>{val}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>*Shared = visitors who also touched another partner across any channel</div>
              </>
            ) : (
              <div style={{ padding: '10px 0', fontSize: 11, color: 'var(--text-dim)' }}>Install beacon on your store to see visitor return/share data for this publication.</div>
            )}
            {statsModal.article_url && <div style={{ marginTop: 12 }}><a href={statsModal.article_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--blue)' }}>View article ↗</a></div>}
          </Modal>
        )
      })()}

      {showAdd && <AddPublicationModal clientId={clientId} campaigns={campaigns} onClose={() => setShowAdd(false)} onCreated={p => setPubs(prev => [p, ...prev])} />}
    </div>
  )
}