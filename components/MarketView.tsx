'use client'
import React, { useState, useCallback, useRef } from 'react'

const PLATFORMS = ['instagram','youtube','twitter','linkedin','facebook','snapchat','other']
const platformIcon: Record<string,string> = {
  instagram:'📸', youtube:'▶️', twitter:'𝕏',
  linkedin:'in', facebook:'𝑓', snapchat:'👻', other:'🔗'
}

const fmtNum = (n: number) => {
  if (n >= 1e7) return (n/1e7).toFixed(1)+'Cr'
  if (n >= 1e5) return (n/1e5).toFixed(1)+'L'
  if (n >= 1000) return (n/1000).toFixed(1)+'K'
  return Math.round(n).toString()
}
const fmtRev = (n: number) => '₹'+fmtNum(n)

interface Summary {
  clicks: number; sales: number; revenue: number
  uniqueVisitors: number; convRate: number
}
interface Influencer {
  id: string; name: string; handle: string
  social_platform: string; clicks: number; revenue: number
}
interface ChannelRow {
  channel: string; label: string; clicks: number
  sales: number; revenue: number; convRate: number
}
interface BuyerRow { pincode: string; orders: number; revenue: number }

export default function MarketView() {
  const [query, setQuery]             = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [location, setLocation]       = useState('')
  const [locationType, setLocationType] = useState<'city'|'country'>('city')
  const [channel, setChannel]         = useState('')
  const [dateRange, setDateRange]     = useState('30')
  const [buyerMode, setBuyerMode]     = useState(false)
  const [loading, setLoading]         = useState(false)
  const [gateStatus, setGateStatus]   = useState<'loading'|'pro_required'|'insufficient_data'|'ok'>('ok')
  const [data, setData]               = useState<any>(null)
  const [empty, setEmpty]             = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSuggestions = useCallback(async (q: string, lt: string) => {
    if (q.length < 2) { setSuggestions([]); return }
    const res  = await fetch(`/api/market-view?locationType=${lt}`)
    const json = await res.json()
    const filtered = (json.suggestions || []).filter((s: string) =>
      s.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 8)
    setSuggestions(filtered)
  }, [])

  const onQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(v, locationType), 250)
  }

  // Check gate on mount
  React.useEffect(() => {
    fetch('/api/market-view').then(res => {
      if (res.status === 403) setGateStatus('pro_required')
      else if (res.status === 503) setGateStatus('insufficient_data')
      else setGateStatus('ok')
    })
  }, [])

  const search = useCallback(async (loc: string) => {
    if (!loc) return
    setLocation(loc); setQuery(loc); setSuggestions([])
    setLoading(true); setData(null); setEmpty(false)
    const params = new URLSearchParams({
      location: loc, locationType, channel,
      dateRange, buyerMode: String(buyerMode),
    })
    const res  = await fetch('/api/market-view?' + params)
    const json = await res.json()
    if (json.empty) setEmpty(true)
    else setData(json)
    setLoading(false)
  }, [locationType, channel, dateRange, buyerMode])

  const reSearch = () => { if (location) search(location) }

  if (gateStatus === 'pro_required') return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 40px', textAlign:'center', gap:12 }}>
      <div style={{ fontSize:32 }}>🔒</div>
      <div style={{ fontSize:16, fontWeight:500, color:'var(--color-text-primary)' }}>Pro plan required</div>
      <div style={{ fontSize:13, color:'var(--color-text-secondary)', maxWidth:340, lineHeight:1.6 }}>
        Market View is available on the Pro plan. Upgrade to unlock it along with Influencer Center and unlimited access.
      </div>
      <a href='/settings?tab=billing' style={{ marginTop:4, padding:'9px 24px', background:'var(--color-brand)', color:'#fff', borderRadius:'var(--border-radius-md)', fontSize:13, fontWeight:500, textDecoration:'none' }}>
        Upgrade to Pro →
      </a>
    </div>
  )

  if (gateStatus === 'insufficient_data') return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 40px', textAlign:'center', gap:12 }}>
      <div style={{ fontSize:32 }}>🌱</div>
      <div style={{ fontSize:16, fontWeight:500, color:'var(--color-text-primary)' }}>This gets better with scale.</div>
      <div style={{ fontSize:13, color:'var(--color-text-secondary)', maxWidth:340, lineHeight:1.6 }}>Come back soon; the platform is growing.</div>
    </div>
  )

  if (gateStatus === 'loading') return (
    <div style={{ textAlign:'center', padding:'80px 0', color:'var(--color-text-tertiary)' }}>Loading…</div>
  )

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Market View
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          See how your campaigns perform by location — clicks, revenue, top influencers, and category conversion rates.
        </p>
      </div>

      {/* Search + filters row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'flex-end' }}>

        {/* Location type toggle */}
        <div style={{ display: 'flex', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-sm)', overflow: 'hidden' }}>
          {(['city','country'] as const).map(lt => (
            <button key={lt} onClick={() => { setLocationType(lt); setQuery(''); setLocation(''); setData(null) }}
              style={{
                padding: '7px 14px', fontSize: 12, border: 'none', cursor: 'pointer',
                background: locationType === lt ? 'var(--color-brand)' : 'var(--color-background-primary)',
                color: locationType === lt ? '#fff' : 'var(--color-text-secondary)',
                fontWeight: locationType === lt ? 500 : 400,
              }}>
              {lt === 'city' ? 'City' : 'Country'}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <input
            value={query} onChange={onQueryChange}
            placeholder={`Search ${locationType}…`}
            onKeyDown={e => e.key === 'Enter' && search(query)}
            style={{
              width: '100%', padding: '7px 12px', boxSizing: 'border-box',
              borderRadius: 'var(--border-radius-sm)',
              border: '0.5px solid var(--color-border-secondary)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)', fontSize: 13,
            }}
          />
          {suggestions.length > 0 && (
            <>
              <div onClick={() => setSuggestions([])} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                background: 'var(--color-background-primary)',
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-sm)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                zIndex: 10, overflow: 'hidden',
              }}>
                {suggestions.map(s => (
                  <div key={s} onClick={() => search(s)}
                    style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--color-text-primary)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >{s}</div>
                ))}
              </div>
            </>
          )}
        </div>

        <button onClick={() => search(query)} style={btnStyle}>Search</button>

        {/* Filters */}
        <FilterSelect value={channel} onChange={e => { setChannel(e.target.value); }} label='Channel'
          options={[{ value: '', label: 'All Channels' }, ...PLATFORMS.map(p => ({ value: p, label: `${platformIcon[p]} ${p.charAt(0).toUpperCase()+p.slice(1)}` }))]} />

        <FilterSelect value={dateRange} onChange={e => setDateRange(e.target.value)} label='Period'
          options={[{ value: '30', label: 'Last 30 days' }, { value: '60', label: 'Last 60 days' }, { value: '90', label: 'Last 90 days' }]} />


        {/* Buyer location toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
          border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-sm)',
          background: buyerMode ? 'var(--color-background-secondary)' : 'var(--color-background-primary)',
          cursor: 'pointer',
        }} onClick={() => { setBuyerMode(b => !b); if (location) reSearch() }}>
          <div style={{
            width: 28, height: 16, borderRadius: 8,
            background: buyerMode ? 'var(--color-brand)' : 'var(--color-border-secondary)',
            position: 'relative', transition: 'background .2s',
          }}>
            <div style={{
              position: 'absolute', top: 2, left: buyerMode ? 14 : 2,
              width: 12, height: 12, borderRadius: '50%',
              background: '#fff', transition: 'left .2s',
            }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Buyer location</span>
        </div>
      </div>

      {/* Results */}
      {!location && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-tertiary)', fontSize: 14 }}>
          Search a city or country to see market performance.
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-tertiary)' }}>
          Loading…
        </div>
      )}

      {empty && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-tertiary)' }}>
          No data found for <strong>{location}</strong> in this period.
        </div>
      )}

      {data && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Location heading */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {data.location}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', background: 'var(--color-background-secondary)', padding: '2px 8px', borderRadius: 'var(--border-radius-sm)' }}>
              Last {data.dateRange} days
            </span>
            {buyerMode && (
              <span style={{ fontSize: 11, color: 'var(--color-brand)', background: 'var(--color-background-secondary)', padding: '2px 8px', borderRadius: 'var(--border-radius-sm)' }}>
                Buyer view
              </span>
            )}
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <StatCard label='Clicks' value={fmtNum(data.summary.clicks)} />
            <StatCard label='Sales' value={fmtNum(data.summary.sales)} />
            <StatCard label='Revenue' value={fmtRev(data.summary.revenue)} />
            <StatCard label='Unique Visitors' value={fmtNum(data.summary.uniqueVisitors)} />
            <StatCard label='Conv. Rate' value={data.summary.convRate + '%'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Top influencers */}
            <div style={panelStyle}>
              <div style={panelTitle}>Top Influencers in {data.location}</div>
              {data.topInfluencers.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', padding: '12px 0' }}>No influencer data for this location.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.topInfluencers.map((inf: Influencer, i: number) => (
                    <div key={inf.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 16 }}>#{i+1}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{inf.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                            {platformIcon[inf.social_platform] || '🔗'} @{inf.handle}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{fmtNum(inf.clicks)} clicks</div>
                        {inf.revenue > 0 && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{fmtRev(inf.revenue)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Channel breakdown — this brand's own channels in this location */}
            <div style={panelStyle}>
              <div style={panelTitle}>Your Channels in {data.location}</div>
              {(!data.channelBreakdown || data.channelBreakdown.length === 0) ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', padding: '12px 0' }}>No channel data for this location yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.channelBreakdown.map((ch: ChannelRow) => (
                    <div key={ch.channel} style={{ padding: '8px 10px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{ch.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{ch.convRate}%</span>
                      </div>
                      <div style={{ height: 3, background: 'var(--color-border-tertiary)', borderRadius: 2 }}>
                        <div style={{ height: '100%', borderRadius: 2, width: `${Math.min(ch.convRate * 10, 100)}%`, background: 'var(--color-brand)', transition: 'width .4s ease' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        <span>{fmtNum(ch.clicks)} clicks</span>
                        <span>{fmtRev(ch.revenue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Buyer pincode data — only shown when buyerMode is on */}
          {buyerMode && (
            <div style={panelStyle}>
              <div style={panelTitle}>Buyer Locations (Pincode)</div>
              {data.buyerData.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', padding: '12px 0' }}>
                  No pincode data available. This requires Shopify integration with shipping address collection enabled.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {data.buyerData.map((b: BuyerRow) => (
                    <div key={b.pincode} style={{ padding: '10px 12px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>{b.pincode}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 3 }}>{b.orders} orders · {fmtRev(b.revenue)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-primary)' }}>{value}</div>
    </div>
  )
}

function FilterSelect({ value, onChange, options, label }: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: { value: string; label: string }[]
  label: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value) || options[0]
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)} style={{
        padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6,
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-sm)',
        background: 'var(--color-background-primary)',
        color: 'var(--color-text-primary)',
        fontSize: 13, cursor: 'pointer', userSelect: 'none',
        whiteSpace: 'nowrap',
      }}>
        <span>{selected.label}</span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>▼</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '100%',
            background: 'var(--color-background-primary)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 'var(--border-radius-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 10, overflow: 'hidden',
          }}>
            {options.map(o => (
              <div key={o.value} onClick={() => { onChange({ target: { value: o.value } } as any); setOpen(false) }}
                style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--color-text-primary)',
                  background: o.value === value ? 'var(--color-background-secondary)' : 'transparent',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = o.value === value ? 'var(--color-background-secondary)' : 'transparent')}
              >{o.label}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'var(--color-background-primary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--border-radius-lg)',
  padding: '16px',
}
const panelTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600,
  color: 'var(--color-text-primary)',
  marginBottom: 12,
}
const btnStyle: React.CSSProperties = {
  padding: '7px 18px', borderRadius: 'var(--border-radius-sm)',
  background: 'var(--color-brand)', color: '#fff',
  border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}
