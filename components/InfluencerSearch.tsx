// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  components/InfluencerSearch.tsx                            │
// │ Replace the existing file at <repo-root>/components/InfluencerSearch.tsx │
// └──────────────────────────────────────────────────────────────────────┘
'use client'
import { useState, useRef } from 'react'
import { INDUSTRY_LABELS } from '@/lib/industries'

interface SearchResult {
  status:       'not_found' | 'no_overlap' | 'overlap'
  found?:       boolean
  handle?:      string
  displayName?: string
  totalClients?: number
  message?:     string
  matches?: {
    collaboratorHandle: string
    collaboratorName:   string
    collaboratorId:     string | null
    overlapPct:         number
    sharedVisitors:     number
    category:           string | null
  }[]
}

export default function InfluencerSearch({ clientId }: { clientId?: string }) {
  const [query,     setQuery]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState<SearchResult | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = async (raw: string) => {
    const handle = raw.replace(/^@/, '').trim()
    if (!handle || handle.length < 2) { setResult(null); return }

    setLoading(true)
    try {
      const res  = await fetch(`/api/influencer-search?handle=${encodeURIComponent(handle)}&clientId=${clientId || ''}`)
      const data = await res.json()
      setResult(data)
    } catch {
      setResult(null)
    }
    setLoading(false)
  }

  const onChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 500)
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Search input */}
      <div style={{ position: 'relative', maxWidth: 380 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-dim)', pointerEvents: 'none' }}>@</span>
        <input
          value={query}
          onChange={e => onChange(e.target.value)}
          placeholder="Search influencer handle"
          style={{ width: '100%', background: 'var(--surface)', border: '0.5px solid var(--border2)', borderRadius: 8, padding: '9px 12px 9px 26px', fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', outline: 'none' }}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-dim)' }}>…</span>
        )}
      </div>

      {/* Result */}
      {result && !loading && (
        <div style={{ marginTop: 10, maxWidth: 480 }}>

          {/* Not in DB */}
          {result.status === 'not_found' && (
            <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '0.5px solid var(--border2)', borderRadius: 8, fontSize: 12, color: 'var(--text-dim)' }}>
              <span style={{ marginRight: 6 }}>○</span>
              No verified information on this profile
            </div>
          )}

          {/* In DB but no overlap with this client's collaborators */}
          {result.status === 'no_overlap' && (
            <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '0.5px solid var(--border2)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <span style={{ color: '#4a7c3f', marginRight: 6 }}>✓</span>
                <strong>@{result.handle}</strong>
                {result.displayName && result.displayName !== result.handle && ` (${result.displayName})`}
                {' '}— profile found
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                No audience overlapping with your past collaborations
              </div>
            </div>
          )}

          {/* Overlaps found */}
          {result.status === 'overlap' && result.matches && (
            <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border2)' }}>
                <span style={{ color: '#4a7c3f', marginRight: 6 }}>✓</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <strong>@{result.handle}</strong>
                  {result.displayName && result.displayName !== result.handle && ` (${result.displayName})`}
                  {' '}— profile found
                </span>
              </div>

              {result.matches.map((m, i) => (
                <div key={i} style={{ padding: '10px 14px', borderBottom: i < result.matches!.length - 1 ? '0.5px solid var(--border3)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      <span style={{ color: 'var(--amber)' }}>@{result.handle}</span>'s audience
                      {m.category && (
                        <span style={{ color: 'var(--text-dim)' }}> in <em>{INDUSTRY_LABELS[m.category] || m.category}</em></span>
                      )}
                      {' '}is overlapping with your earlier collaboration with{' '}
                      <span style={{ color: 'var(--amber)' }}>@{m.collaboratorHandle}</span>
                      {m.collaboratorName && m.collaboratorName !== m.collaboratorHandle && (
                        <span style={{ color: 'var(--text-dim)' }}> ({m.collaboratorName})</span>
                      )}
                    </div>
                    {m.sharedVisitors > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                        {m.sharedVisitors.toLocaleString('en-IN')} shared visitors
                      </div>
                    )}
                  </div>
                  <div style={{ marginLeft: 14, flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 500, color: m.overlapPct > 30 ? '#e74c3c' : m.overlapPct > 15 ? '#d4a843' : '#4a7c3f' }}>
                      {m.overlapPct}%
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>overlap</div>
                  </div>
                </div>
              ))}

              {/* Colour guide */}
              <div style={{ padding: '8px 14px', background: 'var(--surface2)', display: 'flex', gap: 14, fontSize: 10, color: 'var(--text-dim)' }}>
                <span><span style={{ color: '#e74c3c' }}>●</span> High overlap &gt;30%</span>
                <span><span style={{ color: '#d4a843' }}>●</span> Medium 15–30%</span>
                <span><span style={{ color: '#4a7c3f' }}>●</span> Low &lt;15%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
