'use client'
import { useState, useEffect } from 'react'
import AddPublicationModal from './AddPublicationModal'
import CampaignFilter from './CampaignFilter'
import ChannelStatsBar from './ChannelStatsBar'
import AssetInsights from './AssetInsights'

interface Pub { id: string; publication_name: string; author_name?: string; type: string; article_url?: string; redirect_slug: string; destination_url: string; estimated_reach?: number; is_sponsored: boolean; published_at?: string; cost: number; is_active: boolean; campaign_id?: string }
interface Props { clientId: string; campaigns: { id: string; name: string }[]; baseUrl: string; month?: string; onCampaignAdd?: () => void }

export default function SEODashboard({ clientId, campaigns, baseUrl, month, onCampaignAdd }: Props) {
  const [pubs, setPubs] = useState<Pub[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [eventMap, setEventMap] = useState<Record<string, { clicks: number; sales: number; revenue: number }>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState('')

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
      const map: Record<string, { clicks: number; sales: number; revenue: number }> = {}
      // Build per-pub stats from events array in metrics
      for (const e of (metricsData.events || [])) {
        if (!e.publication_id) continue
        if (!map[e.publication_id]) map[e.publication_id] = { clicks: 0, sales: 0, revenue: 0 }
        if (e.type === 'click') map[e.publication_id].clicks++
        else { map[e.publication_id].sales++; map[e.publication_id].revenue += e.order_value || 0 }
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
    await fetch(`/api/publications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !current }) })
    setPubs(prev => prev.map(p => p.id === id ? { ...p, is_active: !current } : p))
  }

  const filtered = selectedCampaign ? pubs.filter(p => p.campaign_id === selectedCampaign) : pubs

  return (
    <div>
      {/* Channel KPI + charts — reacts to campaign filter */}
      <ChannelStatsBar clientId={clientId} channel="seo" campaignId={selectedCampaign} month={month} />
      <AssetInsights clientId={clientId} month={month} channel="seo" />

      {/* Controls */}
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
            const stats = eventMap[pub.id] || { clicks: 0, sales: 0, revenue: 0 }
            const cpc = stats.clicks > 0 && pub.cost > 0 ? pub.cost / stats.clicks : null
            const conv = stats.clicks > 0 ? (stats.sales / stats.clicks * 100) : 0
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

                {/* Per-pub stat cells */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 12 }}>
                  {[
                    ['Clicks',   stats.clicks],
                    ['Sales',    stats.sales],
                    ['Conv',     `${conv.toFixed(1)}%`],
                    ['CPC',      cpc ? `₹${cpc.toFixed(0)}` : '—'],
                    ['Revenue',  `₹${(stats.revenue/1000).toFixed(0)}k`],
                  ].map(([l,v]) => (
                    <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 5, padding: '7px 4px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => copyLink(pub.redirect_slug)} style={{ background: 'transparent', border: `0.5px solid ${copied === pub.redirect_slug ? 'var(--green)' : 'var(--border2)'}`, color: copied === pub.redirect_slug ? 'var(--green)' : 'var(--text-muted)', borderRadius: 5, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                    {copied === pub.redirect_slug ? '✓ Copied' : 'Copy link'}
                  </button>
                  {pub.article_url && <a href={pub.article_url} target="_blank" rel="noopener noreferrer" style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 12px', fontSize: 11, textDecoration: 'none' }}>View article ↗</a>}
                  <button onClick={() => toggleActive(pub.id, pub.is_active)} style={{ border: `0.5px solid ${pub.is_active ? 'var(--border2)' : 'var(--blue)'}`, color: pub.is_active ? 'var(--text-muted)' : 'var(--blue)', background: 'transparent', borderRadius: 5, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
                    {pub.is_active ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {showAdd && <AddPublicationModal clientId={clientId} campaigns={campaigns} onClose={() => setShowAdd(false)} onCreated={p => setPubs(prev => [p, ...prev])} />}
    </div>
  )
}