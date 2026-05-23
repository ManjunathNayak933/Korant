'use client'
import { useState, useEffect, useCallback } from 'react'

interface Profile {
  handle: string
  platform: string
  name: string
  social_url: string
  total_clicks: number
  total_revenue: number
  avg_clicks_per_content: number
  brand_count: number
  best_fit_category: string | null
  content_count: number
}

interface OverlapResult {
  influencerName: string
  handle: string
  overlapPercent: number
}

const PLATFORMS = ['instagram','youtube','twitter','linkedin','facebook','snapchat','other']
const platformIcon: Record<string, string> = {
  instagram:'📸', youtube:'▶️', twitter:'𝕏',
  linkedin:'in', facebook:'𝑓', snapchat:'👻', other:'🔗'
}

const fmtNum = (n: number) => {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M'
  if (n >= 1_000) return (n/1_000).toFixed(1)+'K'
  return Math.round(n).toString()
}
const fmtRev = (n: number) => '₹'+fmtNum(n)

export default function InfluencerCenter() {
  const [profiles, setProfiles]     = useState<Profile[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading]       = useState(true)
  const [page, setPage]             = useState(1)

  // Filters (live — apply on every change)
  const [platform, setPlatform]     = useState('')
  const [category, setCategory]     = useState('')
  const [minRevenue, setMinRevenue] = useState('')
  const [minClicks, setMinClicks]   = useState('')
  const [sortBy, setSortBy]         = useState('avg_clicks_per_content')

  // Overlap panel
  const [selected, setSelected]         = useState<Profile | null>(null)
  const [overlaps, setOverlaps]         = useState<OverlapResult[]>([])
  const [overlapLoading, setOverlapLoading] = useState(false)

  const fetchProfiles = useCallback(async (pg = 1) => {
    setLoading(true)
    const p = new URLSearchParams({ page: String(pg), sortBy })
    if (platform)   p.set('platform', platform)
    if (category)   p.set('category', category)
    if (minRevenue) p.set('minRevenue', minRevenue)
    if (minClicks)  p.set('minClicks', minClicks)
    const res  = await fetch('/api/influencer-center?'+p)
    const json = await res.json()
    setProfiles(json.profiles || [])
    setCategories(json.categories || [])
    setPage(pg)
    setLoading(false)
  }, [platform, category, minRevenue, minClicks, sortBy])

  useEffect(() => { fetchProfiles(1) }, [fetchProfiles])

  const openOverlap = async (profile: Profile) => {
    setSelected(profile)
    setOverlaps([])
    setOverlapLoading(true)
    const key = btoa(`${profile.handle}|${profile.platform}`)
    const res  = await fetch(`/api/influencer-center/${key}/overlap`)
    const json = await res.json()
    setOverlaps(json.overlaps || [])
    setOverlapLoading(false)
  }

  const clearFilters = () => {
    setPlatform(''); setCategory(''); setMinRevenue(''); setMinClicks('')
    setSortBy('avg_clicks_per_content')
  }

  const hasFilters = platform || category || minRevenue || minClicks || sortBy !== 'avg_clicks_per_content'

  return (
    <div style={{ display:'flex', gap:20, alignItems:'flex-start' }}>

      {/* ── Left sidebar filters ── */}
      <div style={{
        width: 220, flexShrink: 0,
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '16px 14px',
        position: 'sticky', top: 16,
      }}>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--color-text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:14 }}>
          Filters
        </div>

        <Label>Channel</Label>
        <Select value={platform} onChange={e => setPlatform(e.target.value)}>
          <option value=''>All Channels</option>
          {PLATFORMS.map(p => (
            <option key={p} value={p}>{platformIcon[p]} {p.charAt(0).toUpperCase()+p.slice(1)}</option>
          ))}
        </Select>

        <Label>Category</Label>
        <Select value={category} onChange={e => setCategory(e.target.value)}>
          <option value=''>All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>

        <Label>Min Revenue (₹)</Label>
        <Input
          type='number' placeholder='e.g. 50000'
          value={minRevenue} onChange={e => setMinRevenue(e.target.value)}
        />

        <Label>Min Avg Clicks</Label>
        <Input
          type='number' placeholder='e.g. 5000'
          value={minClicks} onChange={e => setMinClicks(e.target.value)}
        />

        <Label>Sort by</Label>
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value='avg_clicks_per_content'>Avg Clicks</option>
          <option value='total_revenue'>Revenue</option>
          <option value='brand_count'>Popularity</option>
        </Select>

        {hasFilters && (
          <button onClick={clearFilters} style={{
            marginTop:12, width:'100%', padding:'7px 0',
            borderRadius:'var(--border-radius-sm)',
            border:'0.5px solid var(--color-border-secondary)',
            background:'transparent',
            color:'var(--color-text-secondary)',
            fontSize:12, cursor:'pointer',
          }}>
            Clear filters
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:600, color:'var(--color-text-primary)' }}>
            Influencer Center
          </h2>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--color-text-secondary)' }}>
            Verified performance data across the platform. Min. 500 tracked clicks to appear.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign:'center', padding:80, color:'var(--color-text-tertiary)' }}>Loading…</div>
        ) : profiles.length === 0 ? (
          <div style={{ textAlign:'center', padding:80, color:'var(--color-text-tertiary)' }}>
            No influencers match your filters yet.
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 }}>
            {profiles.map(p => (
              <div
                key={`${p.handle}|${p.platform}`}
                onClick={() => openOverlap(p)}
                style={{
                  background:'var(--color-background-primary)',
                  border:'0.5px solid var(--color-border-tertiary)',
                  borderRadius:'var(--border-radius-lg)',
                  padding:16, cursor:'pointer',
                  transition:'box-shadow 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow='none')}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:600, color:'var(--color-text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize:12, color:'var(--color-text-tertiary)', marginTop:2 }}>
                      {platformIcon[p.platform] || '🔗'} @{p.handle}
                    </div>
                  </div>
                  {p.best_fit_category && (
                    <span style={{
                      fontSize:11, fontWeight:500, whiteSpace:'nowrap',
                      background:'var(--color-background-secondary)',
                      color:'var(--color-text-secondary)',
                      borderRadius:'var(--border-radius-sm)',
                      padding:'3px 8px',
                    }}>{p.best_fit_category}</span>
                  )}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:10 }}>
                  <StatBox label='Avg Clicks' value={fmtNum(p.avg_clicks_per_content)} />
                  <StatBox label='Revenue' value={fmtRev(p.total_revenue)} />
                  <StatBox label='Brands' value={String(p.brand_count)} />
                </div>
                <div style={{ fontSize:11, color:'var(--color-text-tertiary)', borderTop:'0.5px solid var(--color-border-tertiary)', paddingTop:8 }}>
                  {p.content_count} campaign{p.content_count !== 1 ? 's' : ''} · tap to check overlap
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && (profiles.length === 24 || page > 1) && (
          <div style={{ display:'flex', gap:10, justifyContent:'center', marginTop:24 }}>
            {page > 1 && (
              <button style={btnStyle} onClick={() => fetchProfiles(page-1)}>← Prev</button>
            )}
            {profiles.length === 24 && (
              <button style={btnStyle} onClick={() => fetchProfiles(page+1)}>Next →</button>
            )}
          </div>
        )}
      </div>

      {/* ── Overlap side panel ── */}
      {selected && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setSelected(null)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.2)', zIndex:40 }}
          />
          <div style={{
            position:'fixed', top:0, right:0, bottom:0, width:360,
            background:'var(--color-background-primary)',
            borderLeft:'1px solid var(--color-border-secondary)',
            boxShadow:'-4px 0 24px rgba(0,0,0,0.12)',
            zIndex:50, display:'flex', flexDirection:'column',
          }}>
            {/* Panel header */}
            <div style={{ padding:'18px 20px 14px', borderBottom:'0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:600, color:'var(--color-text-primary)' }}>{selected.name}</div>
                  <div style={{ fontSize:12, color:'var(--color-text-tertiary)', marginTop:2 }}>
                    {platformIcon[selected.platform]} @{selected.handle}
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--color-text-secondary)', padding:4, lineHeight:1 }}
                >✕</button>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <StatBox label='Avg Clicks / Content' value={fmtNum(selected.avg_clicks_per_content)} />
                <StatBox label='Total Revenue' value={fmtRev(selected.total_revenue)} />
                <StatBox label='Total Clicks' value={fmtNum(selected.total_clicks)} />
                <StatBox label='Brands' value={String(selected.brand_count)} />
              </div>

              {selected.best_fit_category && (
                <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:12, color:'var(--color-text-secondary)' }}>Best Fit:</span>
                  <span style={{
                    fontSize:11, fontWeight:500,
                    background:'var(--color-background-secondary)',
                    color:'var(--color-text-secondary)',
                    borderRadius:'var(--border-radius-sm)', padding:'3px 8px',
                  }}>{selected.best_fit_category}</span>
                </div>
              )}
            </div>

            {/* Overlap section */}
            <div style={{ padding:'18px 20px', flex:1, overflowY:'auto' }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--color-text-primary)', marginBottom:4 }}>
                Audience Overlap with Your Roster
              </div>
              <div style={{ fontSize:12, color:'var(--color-text-tertiary)', marginBottom:14, lineHeight:1.5 }}>
                Based on tracked visitors from your existing influencers.
              </div>

              {overlapLoading ? (
                <div style={{ color:'var(--color-text-tertiary)', fontSize:13 }}>Checking overlap…</div>
              ) : overlaps.length === 0 ? (
                <div style={{
                  background:'var(--color-background-secondary)',
                  borderRadius:'var(--border-radius-md)',
                  padding:'14px 16px', fontSize:13, color:'var(--color-text-secondary)'
                }}>
                  ✓ No significant audience overlap with your current influencers.
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {overlaps.map((o, i) => (
                    <div key={i} style={{
                      background: o.overlapPercent > 50
                        ? 'var(--color-background-warning)'
                        : 'var(--color-background-secondary)',
                      borderRadius:'var(--border-radius-md)', padding:'12px 14px',
                    }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)' }}>{o.influencerName}</div>
                          <div style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>@{o.handle}</div>
                        </div>
                        <div style={{
                          fontSize:18, fontWeight:600,
                          color: o.overlapPercent > 50 ? '#E06B00' : 'var(--color-text-primary)'
                        }}>
                          {o.overlapPercent}%
                        </div>
                      </div>
                      <div style={{ height:4, background:'var(--color-border-tertiary)', borderRadius:2 }}>
                        <div style={{
                          height:'100%', borderRadius:2,
                          width:`${Math.min(o.overlapPercent,100)}%`,
                          background: o.overlapPercent > 50 ? '#E06B00' : '#1D9E75',
                          transition:'width 0.4s ease',
                        }} />
                      </div>
                      {o.overlapPercent > 50 && (
                        <div style={{ fontSize:11, color:'#E06B00', marginTop:6 }}>
                          High overlap — may reach mostly the same audience.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add to account */}
            <div style={{ padding:'14px 20px', borderTop:'0.5px solid var(--color-border-tertiary)' }}>
              <button
                onClick={() => {
                  window.location.href = `/dashboard?tab=influencer&prefill=${encodeURIComponent(JSON.stringify({
                    name: selected.name,
                    handle: selected.handle,
                    platform: selected.platform,
                    social_url: selected.social_url,
                  }))}`
                }}
                style={{
                  width:'100%', padding:'10px 0',
                  borderRadius:'var(--border-radius-md)',
                  background:'var(--color-brand)', color:'#fff',
                  border:'none', cursor:'pointer', fontSize:14, fontWeight:500,
                }}
              >
                Add to My Account →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background:'var(--color-background-secondary)', borderRadius:'var(--border-radius-sm)', padding:'8px 10px' }}>
      <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:600, color:'var(--color-text-primary)' }}>{value}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:4, marginTop:12 }}>
      {children}
    </div>
  )
}

function Select({ children, value, onChange }: {
  children: React.ReactNode
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
}) {
  return (
    <select
      value={value} onChange={onChange}
      style={{
        width:'100%', padding:'7px 8px',
        borderRadius:'var(--border-radius-sm)',
        border:'0.5px solid var(--color-border-secondary)',
        background:'var(--color-background-primary)',
        color:'var(--color-text-primary)',
        fontSize:13, cursor:'pointer',
        appearance:'auto',
      }}
    >
      {children}
    </select>
  )
}

function Input({ type, placeholder, value, onChange }: {
  type: string; placeholder: string; value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      type={type} placeholder={placeholder} value={value} onChange={onChange}
      style={{
        width:'100%', padding:'7px 8px', boxSizing:'border-box',
        borderRadius:'var(--border-radius-sm)',
        border:'0.5px solid var(--color-border-secondary)',
        background:'var(--color-background-primary)',
        color:'var(--color-text-primary)',
        fontSize:13,
      }}
    />
  )
}

const btnStyle: React.CSSProperties = {
  padding:'7px 18px', borderRadius:'var(--border-radius-sm)',
  background:'var(--color-brand)', color:'#fff',
  border:'none', cursor:'pointer', fontSize:13, fontWeight:500,
}
