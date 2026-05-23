'use client'
import { useState, useEffect, useCallback } from 'react'

interface Profile {
  id: string
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

const fmtNum = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toString()
}
const fmtRev = (n: number) => '₹' + fmtNum(n)

export default function InfluencerCenter() {
  const [profiles, setProfiles]       = useState<Profile[]>([])
  const [categories, setCategories]   = useState<string[]>([])
  const [loading, setLoading]         = useState(true)
  const [page, setPage]               = useState(1)

  // Filters
  const [platform, setPlatform]       = useState('')
  const [category, setCategory]       = useState('')
  const [minRevenue, setMinRevenue]   = useState('')
  const [minClicks, setMinClicks]     = useState('')
  const [sortBy, setSortBy]           = useState('avg_clicks_per_content')

  // Overlap panel
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)
  const [overlaps, setOverlaps]       = useState<OverlapResult[]>([])
  const [overlapLoading, setOverlapLoading]   = useState(false)

  const fetchProfiles = useCallback(async (pg = 1) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(pg), sortBy })
    if (platform)   params.set('platform', platform)
    if (category)   params.set('category', category)
    if (minRevenue) params.set('minRevenue', minRevenue)
    if (minClicks)  params.set('minClicks', minClicks)
    const res = await fetch('/api/influencer-center?' + params)
    const json = await res.json()
    setProfiles(json.profiles || [])
    setCategories(json.categories || [])
    setPage(pg)
    setLoading(false)
  }, [platform, category, minRevenue, minClicks, sortBy])

  useEffect(() => { fetchProfiles(1) }, [fetchProfiles])

  const openOverlap = async (profile: Profile) => {
    setSelectedProfile(profile)
    setOverlaps([])
    setOverlapLoading(true)
    const key = btoa(`${profile.handle}|${profile.platform}`)
    const res = await fetch(`/api/influencer-center/${key}/overlap`)
    const json = await res.json()
    setOverlaps(json.overlaps || [])
    setOverlapLoading(false)
  }

  const platformIcon: Record<string, string> = {
    instagram: '📸', youtube: '▶️', twitter: '𝕏',
    linkedin: 'in', facebook: '𝑓', snapchat: '👻', other: '🔗'
  }

  return (
    <div style={{ padding: '0 0 40px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Influencer Center
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Influencers with verified performance data across the platform. Min. 500 tracked clicks.
        </p>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20,
        padding: '12px 14px', background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-md)',
      }}>
        {/* Channel */}
        <select
          value={platform} onChange={e => setPlatform(e.target.value)}
          style={selectStyle}
        >
          <option value=''>All Channels</option>
          {PLATFORMS.map(p => (
            <option key={p} value={p}>{platformIcon[p]} {p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>

        {/* Best Fit Category */}
        <select
          value={category} onChange={e => setCategory(e.target.value)}
          style={selectStyle}
        >
          <option value=''>All Categories</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Min Revenue */}
        <input
          type='number' placeholder='Min revenue (₹)'
          value={minRevenue} onChange={e => setMinRevenue(e.target.value)}
          style={inputStyle}
        />

        {/* Min avg clicks */}
        <input
          type='number' placeholder='Min avg clicks'
          value={minClicks} onChange={e => setMinClicks(e.target.value)}
          style={inputStyle}
        />

        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selectStyle}>
          <option value='avg_clicks_per_content'>Sort: Avg Clicks</option>
          <option value='total_revenue'>Sort: Revenue</option>
          <option value='brand_count'>Sort: Popularity</option>
        </select>

        <button onClick={() => fetchProfiles(1)} style={btnStyle}>Apply</button>
        <button onClick={() => {
          setPlatform(''); setCategory(''); setMinRevenue(''); setMinClicks(''); setSortBy('avg_clicks_per_content')
        }} style={{ ...btnStyle, background: 'transparent', color: 'var(--color-text-secondary)' }}>
          Clear
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-tertiary)' }}>
          Loading influencers…
        </div>
      ) : profiles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-tertiary)' }}>
          No influencers match your filters yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {profiles.map(p => (
            <div key={p.id} style={cardStyle} onClick={() => openOverlap(p)}>
              {/* Card header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    {platformIcon[p.platform] || '🔗'} @{p.handle}
                  </div>
                </div>
                {p.best_fit_category && (
                  <span style={categoryBadge}>{p.best_fit_category}</span>
                )}
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <Stat label='Avg Clicks' value={fmtNum(p.avg_clicks_per_content)} />
                <Stat label='Revenue' value={fmtRev(p.total_revenue)} />
                <Stat label='Brands' value={String(p.brand_count)} />
              </div>

              {/* Footer */}
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 8 }}>
                {p.content_count} campaign{p.content_count !== 1 ? 's' : ''} tracked · tap to check audience overlap
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {profiles.length === 24 && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
          {page > 1 && <button style={btnStyle} onClick={() => fetchProfiles(page - 1)}>← Prev</button>}
          <button style={btnStyle} onClick={() => fetchProfiles(page + 1)}>Next →</button>
        </div>
      )}

      {/* Overlap side panel */}
      {selectedProfile && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 360,
          background: 'var(--color-background-primary)',
          borderLeft: '1px solid var(--color-border-secondary)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          zIndex: 50, display: 'flex', flexDirection: 'column',
        }}>
          {/* Panel header */}
          <div style={{ padding: '18px 20px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {selectedProfile.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {platformIcon[selectedProfile.platform]} @{selectedProfile.handle}
                </div>
              </div>
              <button
                onClick={() => setSelectedProfile(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-secondary)', padding: 4 }}
              >✕</button>
            </div>

            {/* Full stats in panel */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
              <Stat label='Avg Clicks / Content' value={fmtNum(selectedProfile.avg_clicks_per_content)} />
              <Stat label='Total Revenue' value={fmtRev(selectedProfile.total_revenue)} />
              <Stat label='Total Clicks' value={fmtNum(selectedProfile.total_clicks)} />
              <Stat label='Brands Worked With' value={String(selectedProfile.brand_count)} />
            </div>

            {selectedProfile.best_fit_category && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Best Fit:</span>
                <span style={categoryBadge}>{selectedProfile.best_fit_category}</span>
              </div>
            )}
          </div>

          {/* Overlap section */}
          <div style={{ padding: '18px 20px', flex: 1, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              Audience Overlap with Your Roster
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 14, lineHeight: 1.5 }}>
              Based on tracked visitors across your existing influencers.
            </div>

            {overlapLoading ? (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>Checking overlap…</div>
            ) : overlaps.length === 0 ? (
              <div style={{
                background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)',
                padding: '14px 16px', fontSize: 13, color: 'var(--color-text-secondary)'
              }}>
                ✓ No significant audience overlap detected with your current influencers.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {overlaps.map((o, i) => (
                  <div key={i} style={{
                    background: o.overlapPercent > 50
                      ? 'var(--color-background-warning)'
                      : 'var(--color-background-secondary)',
                    borderRadius: 'var(--border-radius-md)',
                    padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{o.influencerName}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>@{o.handle}</div>
                      </div>
                      <div style={{
                        fontSize: 18, fontWeight: 600,
                        color: o.overlapPercent > 50 ? 'var(--color-text-warning)' : 'var(--color-text-primary)'
                      }}>
                        {o.overlapPercent}%
                      </div>
                    </div>
                    {/* Overlap bar */}
                    <div style={{ height: 4, background: 'var(--color-border-tertiary)', borderRadius: 2 }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${Math.min(o.overlapPercent, 100)}%`,
                        background: o.overlapPercent > 50 ? '#E06B00' : '#1D9E75',
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    {o.overlapPercent > 50 && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-warning)', marginTop: 6 }}>
                        High overlap — adding this influencer may reach mostly the same audience.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add to account CTA */}
          <div style={{ padding: '14px 20px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
            <button
              onClick={() => {
                window.location.href = `/dashboard?tab=influencer&prefill=${encodeURIComponent(JSON.stringify({
                  name: selectedProfile.name,
                  handle: selectedProfile.handle,
                  platform: selectedProfile.platform,
                  social_url: selectedProfile.social_url,
                }))}`
              }}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-brand)', color: '#fff',
                border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500,
              }}
            >
              Add to My Account →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)', padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>{value}</div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 'var(--border-radius-sm)',
  border: '0.5px solid var(--color-border-secondary)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontSize: 13, cursor: 'pointer',
}
const inputStyle: React.CSSProperties = {
  ...selectStyle, width: 140,
}
const btnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 'var(--border-radius-sm)',
  background: 'var(--color-brand)', color: '#fff',
  border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}
const cardStyle: React.CSSProperties = {
  background: 'var(--color-background-primary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--border-radius-lg)',
  padding: '16px', cursor: 'pointer',
  transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
}
const categoryBadge: React.CSSProperties = {
  fontSize: 11, fontWeight: 500,
  background: 'var(--color-background-secondary)',
  color: 'var(--color-text-secondary)',
  borderRadius: 'var(--border-radius-sm)',
  padding: '3px 8px', whiteSpace: 'nowrap',
}
