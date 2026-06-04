'use client'
import { useCouponIntegrations, CouponStatusHint } from './CouponStatusHint'
import { useState, useRef, useEffect } from 'react'
import Modal from './Modal'
import { FormField, Input, Select, SubmitButton, UrlInput } from './FormFields'

interface Props {
  clientId: string
  campaigns: { id: string; name: string }[]
  onClose: () => void
  onCreated: (inf: any) => void
}

interface CheckResult {
  status: 'new' | 'own' | 'platform'
  influencer?: {
    id: string; name: string; handle: string
    social_platform: string; redirect_slug: string
    is_active: boolean; campaign_id?: string; campaign_name?: string
  }
  platformData?: {
    name: string; total_clicks: number; total_revenue: number
    avg_clicks_per_content: number; brand_count: number
    best_fit_label?: string | null
  } | null
}

const fmtNum = (n: number) => n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n)
const fmtRev = (n: number) => '₹' + (n >= 100000 ? (n/100000).toFixed(1)+'L' : n >= 1000 ? (n/1000).toFixed(0)+'K' : String(Math.round(n)))

export default function AddInfluencerModal({ clientId, campaigns, onClose, onCreated }: Props) {
  const couponIntegrations = useCouponIntegrations()
  const [form, setForm] = useState({
    name: '', handle: '', social_platform: 'instagram',
    social_url: '', destination_url: '', discount_code: '', fee: '', campaign_id: ''
  })
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [check, setCheck]       = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Real-time handle check
  useEffect(() => {
    const handle = form.handle.replace(/^@/, '').trim()
    if (handle.length < 2) { setCheck(null); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setChecking(true)
      try {
        const res  = await fetch(`/api/influencers/check?handle=${encodeURIComponent(handle)}&platform=${form.social_platform}&clientId=${clientId}`)
        const data: CheckResult = await res.json()
        setCheck(data)
        // Auto-fill name and social_url if platform data available and name is empty
        if (data.status === 'platform' && data.platformData && !form.name) {
          setForm(f => ({
            ...f,
            name: f.name || data.platformData!.name || '',
          }))
        }
      } catch { setCheck(null) }
      setChecking(false)
    }, 500)
  }, [form.handle, form.social_platform, clientId])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // If already in own account, just assign to campaign via junction table
      if (check?.status === 'own' && check.influencer) {
        if (!form.campaign_id) {
          setError('Select a campaign to assign this influencer to.')
          setLoading(false); return
        }
        const res = await fetch('/api/influencers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, clientId, fee: parseFloat(form.fee) || 0 }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Failed'); setLoading(false); return }
        onCreated(data); onClose(); return
      }

      const res = await fetch('/api/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, clientId, fee: parseFloat(form.fee) || 0 }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed'); setLoading(false); return }
      onCreated(data); onClose()
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  const isOwn      = check?.status === 'own'
  const isPlatform = check?.status === 'platform'

  return (
    <Modal title="Add influencer" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Name" required={!isOwn}>
            <Input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Priya Kapoor" required={!isOwn} disabled={isOwn} />
          </FormField>
          <FormField label="Handle" required>
            <div style={{ position: 'relative' }}>
              <Input value={form.handle} onChange={e => set('handle', e.target.value)}
                placeholder="@priyaglow" required />
              {checking && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-dim)' }}>checking…</span>
              )}
            </div>
          </FormField>
        </div>

        {/* ── ALREADY IN YOUR ACCOUNT ── */}
        {isOwn && check?.influencer && (
          <div style={{ margin: '8px 0 14px', padding: '12px 14px', background: 'rgba(212,168,67,0.08)', border: '0.5px solid rgba(212,168,67,0.3)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)', marginBottom: 2 }}>
                  Already in your account
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {check.influencer.name} · @{check.influencer.handle} · {check.influencer.social_platform}
                </div>
                {check.influencer.campaign_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    Currently in campaign: <strong>{check.influencer.campaign_name}</strong>
                  </div>
                )}
              </div>
              <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4,
                background: check.influencer.is_active ? 'rgba(46,204,113,0.1)' : 'rgba(90,86,82,0.2)',
                border: `0.5px solid ${check.influencer.is_active ? 'rgba(46,204,113,0.3)' : 'var(--border2)'}`,
                color: check.influencer.is_active ? '#2ecc71' : 'var(--text-dim)' }}>
                {check.influencer.is_active ? 'active' : 'paused'}
              </span>
            </div>
            {/* Platform stats if available */}
            {check.platformData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 8 }}>
                {[
                  ['Avg clicks', fmtNum(check.platformData.avg_clicks_per_content)],
                  ['Revenue', fmtRev(check.platformData.total_revenue)],
                  ['Brands', String(check.platformData.brand_count)],
                ].map(([l, v]) => (
                  <div key={l} style={{ textAlign: 'center', background: 'var(--surface2)', borderRadius: 5, padding: '5px 4px' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Select a campaign below to assign her to it. No duplicate will be created.
            </div>
          </div>
        )}

        {/* ── PLATFORM DATA SUGGESTION (not in own account) ── */}
        {isPlatform && check?.platformData && (
          <div style={{ margin: '8px 0 14px', padding: '12px 14px', background: 'rgba(74,158,255,0.06)', border: '0.5px solid rgba(74,158,255,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4a9eff', marginBottom: 6 }}>
              Verified track record on platform
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 6 }}>
              {[
                ['Avg clicks', fmtNum(check.platformData.avg_clicks_per_content)],
                ['Revenue', fmtRev(check.platformData.total_revenue)],
                ['Brands', String(check.platformData.brand_count)],
              ].map(([l, v]) => (
                <div key={l} style={{ textAlign: 'center', background: 'var(--surface2)', borderRadius: 5, padding: '5px 4px' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                </div>
              ))}
            </div>
            {check.platformData.best_fit_label && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Best Fit: <strong style={{ color: '#4a9eff' }}>{check.platformData.best_fit_label}</strong>
              </div>
            )}
          </div>
        )}

        {/* Hide platform/details fields if already in own account */}
        {!isOwn && (
          <>
            <FormField label="Platform">
              <Select value={form.social_platform} onChange={e => set('social_platform', e.target.value)} options={[
                { value: 'instagram', label: 'Instagram' },
                { value: 'youtube',   label: 'YouTube' },
                { value: 'twitter',   label: 'Twitter/X' },
                { value: 'tiktok',    label: 'TikTok' },
              ]} />
            </FormField>
            <FormField label="Social URL">
              <UrlInput value={form.social_url} onChange={v => set('social_url', v)} placeholder="instagram.com/priyaglow" />
            </FormField>
            <FormField label="Destination URL" required>
              <UrlInput value={form.destination_url} onChange={v => set('destination_url', v)} placeholder="yourbrand.com/priya" required />
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Discount code">
                <Input value={form.discount_code} onChange={e => set('discount_code', e.target.value.toUpperCase())} placeholder="PRIYA15" />
                <CouponStatusHint code={form.discount_code} status={couponIntegrations} />
              </FormField>
              <FormField label="Fee (₹)">
                <Input type="number" value={form.fee} onChange={e => set('fee', e.target.value)} placeholder="0" />
              </FormField>
            </div>
          </>
        )}

        {campaigns.length > 0 && (
          <FormField label={isOwn ? "Assign to campaign" : "Campaign"} required={isOwn}>
            <Select value={form.campaign_id} onChange={e => set('campaign_id', e.target.value)}
              options={[{ value: '', label: isOwn ? 'Select campaign…' : 'No campaign' },
                ...campaigns.map(c => ({ value: c.id, label: c.name }))]} />
          </FormField>
        )}

        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <SubmitButton loading={loading}
            label={isOwn ? 'Add to campaign' : 'Add influencer'} />
        </div>
      </form>
    </Modal>
  )
}
