'use client'
import { useState, useEffect } from 'react'
import AddAffiliateModal from './AddAffiliateModal'
import Modal from './Modal'
import CampaignFilter from './CampaignFilter'
import ChannelStatsBar from './ChannelStatsBar'
import AssetInsights, { useAssetData } from './AssetInsights'
import { FormField, Input, Select, Textarea, SubmitButton, UrlInput } from './FormFields'

interface Affiliate {
  id: string; name: string; handle: string; email?: string; phone?: string
  is_active: boolean; paused_at?: string; paused_reason?: string; source: string
  redirect_slug: string; discount_code?: string; commission_type: string
  commission_value: number; commission_trigger: string; created_at: string
  campaign_id?: string; program_id?: string; destination_url: string; attribution_window_days: number
}
interface Program {
  id: string; name: string; description: string; commission_type: string; commission_value: number
  commission_trigger: string; attribution_window_days: number; is_public: boolean; is_active: boolean
}
interface AffStats { clicks: number; sales: number; revenue: number; commission: number; conversionRate?: number; codeRedemptions?: number }
interface Props {
  clientId: string; campaigns: { id: string; name: string }[]
  baseUrl: string; month?: string; onCampaignAdd?: () => void
}

type SortKey = 'clicks' | 'sales' | 'revenue' | 'commission'

// ── Add / Edit Program Modal ────────────────────────────────────────────────
function ProgramModal({ clientId, existing, onClose, onSaved }: { clientId: string; existing?: Program; onClose: () => void; onSaved: (p: Program) => void }) {
  const [form, setForm] = useState({
    name:                   existing?.name                   ?? '',
    description:            existing?.description            ?? '',
    commission_type:        existing?.commission_type        ?? 'percentage',
    commission_value:       String(existing?.commission_value ?? '10'),
    commission_trigger:     existing?.commission_trigger     ?? 'per_sale',
    attribution_window_days: String(existing?.attribution_window_days ?? '30'),
    is_public:              existing?.is_public              ?? false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const payload = {
      clientId,
      name: form.name,
      description: form.description,
      commission_type: form.commission_type,
      commission_value: parseFloat(form.commission_value),
      commission_trigger: form.commission_trigger,
      attribution_window_days: parseInt(form.attribution_window_days),
      is_public: form.is_public,
    }
    const res = existing
      ? await fetch(`/api/affiliate-programs/${existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/affiliate-programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error || 'Failed'); return }
    onSaved(data); onClose()
  }

  return (
    <Modal title={existing ? `Edit — ${existing.name}` : 'New program'} onClose={onClose}>
      <form onSubmit={submit}>
        <FormField label="Program name" required><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Summer Creators" required /></FormField>
        <FormField label="Description"><Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Open to all nano-influencers" /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Commission type">
            <Select value={form.commission_type} onChange={e => set('commission_type', e.target.value)}
              options={[{ value: 'percentage', label: 'Percentage (%)' }, { value: 'flat', label: 'Flat (₹)' }]} />
          </FormField>
          <FormField label={form.commission_type === 'percentage' ? 'Commission %' : 'Commission ₹'} required>
            <Input type="number" value={form.commission_value} onChange={e => set('commission_value', e.target.value)} required />
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Trigger">
            <Select value={form.commission_trigger} onChange={e => set('commission_trigger', e.target.value)}
              options={[{ value: 'per_sale', label: 'Per sale' }, { value: 'per_lead', label: 'Per lead' }]} />
          </FormField>
          <FormField label="Attribution window (days)">
            <Input type="number" value={form.attribution_window_days} onChange={e => set('attribution_window_days', e.target.value)} />
          </FormField>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <input type="checkbox" id="is_public" checked={form.is_public} onChange={e => set('is_public', e.target.checked)} />
          <label htmlFor="is_public" style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>Public — show on self-signup page</label>
        </div>
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <SubmitButton loading={loading} label={existing ? 'Save changes' : 'Create program'} />
        </div>
      </form>
    </Modal>
  )
}

// ── Program Analytics Modal ─────────────────────────────────────────────────
// Program-wide rollup computed from the per-affiliate stats already loaded for
// the selected month — no extra fetch, and consistent with the rest of the tab.
function ProgramAnalyticsModal({ program, affiliates, statsById, month, onClose }: {
  program: Program
  affiliates: Affiliate[]
  statsById: Record<string, AffStats>
  month?: string
  onClose: () => void
}) {
  const members = affiliates.filter(a => a.program_id === program.id)
  const active  = members.filter(a => a.is_active).length
  const paused  = members.length - active

  const tot = members.reduce((acc, a) => {
    const s = statsById[a.id] || { clicks: 0, sales: 0, revenue: 0, commission: 0 }
    acc.clicks += s.clicks; acc.sales += s.sales; acc.revenue += s.revenue; acc.commission += s.commission
    return acc
  }, { clicks: 0, sales: 0, revenue: 0, commission: 0 })

  const convRate    = tot.clicks > 0 ? (tot.sales / tot.clicks * 100) : 0
  const commPct     = tot.revenue > 0 ? (tot.commission / tot.revenue * 100) : 0
  const avgOrder    = tot.sales > 0 ? (tot.revenue / tot.sales) : 0
  const activeEarners = members.filter(a => (statsById[a.id]?.sales || 0) > 0).length

  const ranked = [...members]
    .map(a => ({ a, s: statsById[a.id] || { clicks: 0, sales: 0, revenue: 0, commission: 0 } }))
    .sort((x, y) => y.s.revenue - x.s.revenue)

  const monthLabel = month
    ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'All time'

  const kpi = (label: string, value: string | number, color = 'var(--text-primary)') => (
    <div key={label} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 500, color }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{label}</div>
    </div>
  )

  const maxRev = Math.max(1, ...ranked.map(r => r.s.revenue))

  return (
    <Modal title={`${program.name} — analytics`} onClose={onClose}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
        {monthLabel} · {program.commission_value}{program.commission_type === 'percentage' ? '%' : '₹'} per {program.commission_trigger.replace('_', ' ')} · {program.attribution_window_days}d window
      </div>

      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 8 }}>Roster</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
        {kpi('Affiliates', members.length)}
        {kpi('Active', active, 'var(--green)')}
        {kpi('Paused', paused, 'var(--amber)')}
      </div>

      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 8 }}>Performance</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
        {kpi('Clicks', tot.clicks)}
        {kpi('Sales', tot.sales)}
        {kpi('Revenue', `₹${tot.revenue.toLocaleString('en-IN')}`)}
        {kpi('Commission', `₹${tot.commission.toFixed(0)}`, 'var(--green)')}
        {kpi('Conv rate', `${convRate.toFixed(1)}%`)}
        {kpi('Comm / rev', `${commPct.toFixed(1)}%`, 'var(--amber)')}
        {kpi('Avg order', `₹${avgOrder.toFixed(0)}`)}
        {kpi('Earning affiliates', `${activeEarners}/${members.length}`)}
      </div>

      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 8 }}>Affiliates by revenue</div>
      {ranked.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>No affiliates in this program yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ranked.map(({ a, s }, i) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', width: 16, textAlign: 'right' }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name} <span style={{ color: 'var(--text-dim)' }}>{a.handle}</span></span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>₹{s.revenue.toLocaleString('en-IN')} · {s.sales} sales · ₹{s.commission.toFixed(0)} comm</span>
                </div>
                <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(s.revenue / maxRev) * 100}%`, height: '100%', background: a.is_active ? 'var(--green)' : 'var(--text-dim)', borderRadius: 3 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 14 }}>Figures reflect {monthLabel.toLowerCase()} and exclude refunded/cancelled sales.</div>
    </Modal>
  )
}

// ── Edit Affiliate Modal ────────────────────────────────────────────────────
function EditAffiliateModal({ affiliate, programs, campaigns, onClose, onSaved }: { affiliate: Affiliate; programs: Program[]; campaigns: { id: string; name: string }[]; onClose: () => void; onSaved: (a: Affiliate) => void }) {
  const [form, setForm] = useState({
    name:             affiliate.name,
    handle:           affiliate.handle,
    email:            affiliate.email          ?? '',
    phone:            affiliate.phone          ?? '',
    destination_url:  affiliate.destination_url,
    discount_code:    affiliate.discount_code  ?? '',
    commission_type:  affiliate.commission_type,
    commission_value: String(affiliate.commission_value),
    campaign_id:      affiliate.campaign_id    ?? '',
    program_id:       affiliate.program_id     ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Selecting a program inherits its commission settings, matching how new
  // affiliates are created. Picking "Custom commission" leaves the values as-is.
  const onProgramChange = (programId: string) => {
    const prog = programs.find(p => p.id === programId)
    setForm(f => ({
      ...f,
      program_id: programId,
      ...(prog ? { commission_type: prog.commission_type, commission_value: String(prog.commission_value) } : {}),
    }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch(`/api/affiliates/${affiliate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, commission_value: parseFloat(form.commission_value) }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error || 'Failed'); return }
    onSaved(data); onClose()
  }

  return (
    <Modal title={`Edit — ${affiliate.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Name" required><Input value={form.name} onChange={e => set('name', e.target.value)} required /></FormField>
          <FormField label="Handle" required><Input value={form.handle} onChange={e => set('handle', e.target.value)} required /></FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Email"><Input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></FormField>
          <FormField label="Phone"><Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></FormField>
        </div>
        <FormField label="Destination URL" required><UrlInput value={form.destination_url} onChange={v => set('destination_url', v)} required /></FormField>
        <FormField label="Discount code"><Input value={form.discount_code} onChange={e => set('discount_code', e.target.value.toUpperCase())} /></FormField>
        {programs.length > 0 && (
          <FormField label="Program">
            <Select value={form.program_id} onChange={e => onProgramChange(e.target.value)}
              options={[{ value: '', label: 'Custom commission' }, ...programs.map(p => ({ value: p.id, label: `${p.name} (${p.commission_value}${p.commission_type === 'percentage' ? '%' : '₹'})` }))]} />
          </FormField>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Commission type">
            <Select value={form.commission_type} onChange={e => set('commission_type', e.target.value)}
              options={[{ value: 'percentage', label: 'Percentage (%)' }, { value: 'flat', label: 'Flat (₹)' }]} />
          </FormField>
          <FormField label={form.commission_type === 'percentage' ? 'Commission %' : 'Commission ₹'}>
            <Input type="number" value={form.commission_value} onChange={e => set('commission_value', e.target.value)} />
          </FormField>
        </div>
        {campaigns.length > 0 && (
          <FormField label="Campaign">
            <Select value={form.campaign_id} onChange={e => set('campaign_id', e.target.value)}
              options={[{ value: '', label: 'No campaign' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]} />
          </FormField>
        )}
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <SubmitButton loading={loading} label="Save changes" />
        </div>
      </form>
    </Modal>
  )
}

// ── Main Dashboard ──────────────────────────────────────────────────────────
export default function AffiliateDashboard({ clientId, campaigns, baseUrl, month, onCampaignAdd }: Props) {
  const [subTab, setSubTab]               = useState<'affiliates' | 'programs' | 'ambassadors'>('affiliates')
  const [affiliates, setAffiliates]       = useState<Affiliate[]>([])
  const [programs, setPrograms]           = useState<Program[]>([])
  const [allMetrics, setAllMetrics]       = useState<any>(null)
  const [affStats, setAffStats]           = useState<Record<string, AffStats>>({})
  const [loading, setLoading]             = useState(true)
  const [showAdd, setShowAdd]             = useState(false)
  const [editAffiliate, setEditAffiliate] = useState<Affiliate | null>(null)
  const [editProgram, setEditProgram]     = useState<Program | null>(null)
  const [showNewProgram, setShowNewProgram] = useState(false)
  const [statsModal, setStatsModal]       = useState<Affiliate | null>(null)
  const [pauseModal, setPauseModal]       = useState<Affiliate | null>(null)
  const [deleteAffModal, setDeleteAffModal] = useState<Affiliate | null>(null)
  const [deleteProgModal, setDeleteProgModal] = useState<Program | null>(null)
  const [analyticsProgram, setAnalyticsProgram] = useState<Program | null>(null)
  const [pauseReason, setPauseReason]     = useState('')
  const [copied, setCopied]               = useState<string | null>(null)
  const [statusFilter, setStatusFilter]   = useState('all')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [sort, setSort]                   = useState<SortKey>('clicks')
  const [affiliateSlug, setAffiliateSlug] = useState<string | null>(null)

  const { data: assetData } = useAssetData(clientId, month, 'affiliate')
  const visitorMap: Record<string, { unique: number; returned: number; shared: number; returnRate: number; sharedRate: number }> = {}
  ;(assetData?.partnerStats || []).forEach((p: any) => { visitorMap[p.id] = p })

  // The public join link is keyed by the client's affiliate_slug (not the id),
  // so fetch it once. If it can't be loaded, the join-link UI is simply hidden.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/clients/${clientId}`)
      .then(r => r.ok ? r.json() : null)
      .then(c => { if (!cancelled && c?.affiliate_slug) setAffiliateSlug(c.affiliate_slug) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clientId])

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
      const [affData, progData, metricsData] = await Promise.all([
        affRes.json(), progRes.json(), metricsRes.json()
      ])
      setAffiliates(Array.isArray(affData) ? affData : [])
      setPrograms(Array.isArray(progData) ? progData : [])
      setAllMetrics(metricsData)
      const map: Record<string, AffStats> = {}
      for (const aff of (metricsData.affiliates || [])) {
        map[aff.affiliateId] = {
          clicks:          aff.clicks          || 0,
          sales:           aff.sales           || 0,
          revenue:         aff.revenue         || 0,
          commission:      aff.commission      || 0,
          conversionRate:  aff.conversionRate  || 0,
          codeRedemptions: aff.codeRedemptions || 0,
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
    const res = await fetch(`/api/affiliates/${pauseModal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: false, paused_reason: pauseReason }) })
    if (!res.ok) { alert('Failed to pause affiliate.'); return }
    setAffiliates(prev => prev.map(a => a.id === pauseModal.id ? { ...a, is_active: false, paused_at: new Date().toISOString(), paused_reason: pauseReason } : a))
    setPauseModal(null); setPauseReason('')
  }

  const resume = async (id: string) => {
    const res = await fetch(`/api/affiliates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: true }) })
    if (!res.ok) { alert('Failed to resume affiliate.'); return }
    setAffiliates(prev => prev.map(a => a.id === id ? { ...a, is_active: true, paused_at: undefined } : a))
  }

  const deleteAffiliate = async () => {
    if (!deleteAffModal) return
    const res = await fetch(`/api/affiliates/${deleteAffModal.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to delete affiliate.'); return }
    setAffiliates(prev => prev.filter(a => a.id !== deleteAffModal.id))
    setDeleteAffModal(null)
  }

  const deleteProgram = async () => {
    if (!deleteProgModal) return
    const res = await fetch(`/api/affiliate-programs/${deleteProgModal.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to delete program.'); return }
    setPrograms(prev => prev.filter(p => p.id !== deleteProgModal.id))
    setDeleteProgModal(null)
  }

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${baseUrl}/r/${slug}`)
    setCopied(slug); setTimeout(() => setCopied(null), 1500)
  }

  const regularAffiliates  = affiliates.filter(a => a.source !== 'public_signup')
  const ambassadors         = affiliates.filter(a => a.source === 'public_signup')
  const filteredRegular     = selectedCampaign ? regularAffiliates.filter(a => a.campaign_id === selectedCampaign) : regularAffiliates
  const sortedRegular       = [...filteredRegular].sort((a, b) => {
    const sa = affStats[a.id] || { clicks:0, sales:0, revenue:0, commission:0 }
    const sb = affStats[b.id] || { clicks:0, sales:0, revenue:0, commission:0 }
    if (sort === 'clicks')     return sb.clicks     - sa.clicks
    if (sort === 'sales')      return sb.sales      - sa.sales
    if (sort === 'revenue')    return sb.revenue    - sa.revenue
    if (sort === 'commission') return sb.commission - sa.commission
    return 0
  })
  const sortedAmbassadors   = [...ambassadors].sort((a, b) => {
    const sa = affStats[a.id] || { clicks:0, sales:0, revenue:0, commission:0 }
    const sb = affStats[b.id] || { clicks:0, sales:0, revenue:0, commission:0 }
    if (sort === 'clicks')     return sb.clicks     - sa.clicks
    if (sort === 'sales')      return sb.sales      - sa.sales
    if (sort === 'revenue')    return sb.revenue    - sa.revenue
    if (sort === 'commission') return sb.commission - sa.commission
    return 0
  })
  const filteredAmbassadors = statusFilter === 'all' ? sortedAmbassadors : sortedAmbassadors.filter(a => statusFilter === 'active' ? a.is_active : !a.is_active)

  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'clicks', label: 'Clicks' }, { value: 'sales', label: 'Sales' },
    { value: 'revenue', label: 'Revenue' }, { value: 'commission', label: 'Commission' },
  ]

  // Shared affiliate card renderer — used for both Affiliates and Ambassadors tabs
  const renderAffCard = (aff: Affiliate) => {
    const st = affStats[aff.id] || { clicks:0, sales:0, revenue:0, commission:0, conversionRate:0, codeRedemptions:0 }
    const v  = visitorMap[aff.id]
    const convRate = st.conversionRate ? st.conversionRate.toFixed(1) : (st.clicks > 0 ? (st.sales / st.clicks * 100).toFixed(1) : '0')
    return (
      <div key={aff.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, opacity: aff.is_active ? 1 : 0.55 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface2)', border: '0.5px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: 'var(--green)', flexShrink: 0 }}>
            {aff.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{aff.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{aff.handle}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--green)' }}>{aff.commission_value}{aff.commission_type === 'percentage' ? '%' : '₹'}</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{aff.commission_trigger.replace('_', ' ')}</div>
          </div>
        </div>

        {/* Performance stats — 4 core KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 5 }}>
          {[
            ['Clicks',  st.clicks],
            ['Sales',   st.sales],
            ['Rev',     `₹${(st.revenue / 1000).toFixed(1)}k`],
            ['Comm',    `₹${st.commission.toFixed(0)}`],
          ].map(([l, val]) => (
            <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: '5px 3px' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{val}</div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Secondary stats — conv rate + code redemptions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 5 }}>
          {[
            ['Conv rate',  `${convRate}%`,          'var(--text-primary)'],
            ['Code sales', st.codeRedemptions ?? 0, 'var(--text-primary)'],
          ].map(([l, val, col]) => (
            <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: '5px 3px' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: col as string }}>{val}</div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Visitor breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginBottom: 10 }}>
          {[
            ['Unique',   v?.unique   ?? '—', 'var(--amber)'],
            ['Returned', v?.returned ?? '—', '#4a9eff'],
            ['Shared',   v?.shared   ?? '—', '#9b59b6'],
          ].map(([l, val, col]) => (
            <div key={l as string} style={{ textAlign: 'center', background: `${col}11`, border: `0.5px solid ${col}33`, borderRadius: 5, padding: '5px 3px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: col as string }}>{val}</div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 1 }}>{l}</div>
            </div>
          ))}
        </div>

        {aff.discount_code && <div style={{ marginBottom: 10 }}><span className="disc-code">{aff.discount_code}</span></div>}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
          <button onClick={() => setStatsModal(aff)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 0', fontSize: 10, cursor: 'pointer' }}>Stats</button>
          <button onClick={() => copyLink(aff.redirect_slug)} style={{ background: 'transparent', border: `0.5px solid ${copied === aff.redirect_slug ? 'var(--green)' : 'var(--border2)'}`, color: copied === aff.redirect_slug ? 'var(--green)' : 'var(--text-muted)', borderRadius: 5, padding: '5px 0', fontSize: 10, cursor: 'pointer' }}>
            {copied === aff.redirect_slug ? '✓' : 'Link'}
          </button>
          <button onClick={() => setEditAffiliate(aff)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 0', fontSize: 10, cursor: 'pointer' }}>Edit</button>
          <button onClick={() => aff.is_active ? setPauseModal(aff) : resume(aff.id)} style={{ background: 'transparent', border: `0.5px solid ${aff.is_active ? 'var(--border2)' : 'var(--amber)'}`, color: aff.is_active ? 'var(--text-muted)' : 'var(--amber)', borderRadius: 5, padding: '5px 0', fontSize: 10, cursor: 'pointer' }}>
            {aff.is_active ? 'Pause' : 'Resume'}
          </button>
        </div>
        <button onClick={() => setDeleteAffModal(aff)} style={{ marginTop: 5, width: '100%', background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-dim)', borderRadius: 5, padding: '4px 0', fontSize: 10, cursor: 'pointer' }}>Delete</button>
      </div>
    )
  }

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: 20 }}>
        {([
          ['affiliates',  `Affiliates (${regularAffiliates.length})`],
          ['programs',    `Programs (${programs.length})`],
          ['ambassadors', `Ambassadors (${ambassadors.length})`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)} style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${subTab === id ? 'var(--amber)' : 'transparent'}`, color: subTab === id ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      <ChannelStatsBar clientId={clientId} channel="affiliate" campaignId={selectedCampaign} month={month} />
      <AssetInsights clientId={clientId} month={month} channel="affiliate" />

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 240, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, opacity: 0.4 }} />)}
        </div>
      ) : (
        <>
          {/* ── AFFILIATES ── */}
          {subTab === 'affiliates' && (
            <div>
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

              {sortedRegular.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 20, marginBottom: 10 }}>🔗</div>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>{selectedCampaign ? 'No affiliates in this campaign' : 'No affiliates yet'}</div>
                  <button onClick={() => setShowAdd(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Add first affiliate</button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
                  {sortedRegular.map(renderAffCard)}
                </div>
              )}
              {showAdd && <AddAffiliateModal clientId={clientId} programs={programs} campaigns={campaigns} onClose={() => setShowAdd(false)} onCreated={a => setAffiliates(prev => [a, ...prev])} />}
            </div>
          )}

          {/* ── PROGRAMS ── */}
          {subTab === 'programs' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                <button onClick={() => setShowNewProgram(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '6px 13px', fontSize: 12, cursor: 'pointer' }}>+ Program</button>
              </div>
              {programs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No programs yet. Create one to define commission structures for affiliates.</div>
                </div>
              ) : programs.map(prog => {
                const progAffiliates = affiliates.filter(a => a.program_id === prog.id)
                const totClicks  = progAffiliates.reduce((s, a) => s + (affStats[a.id]?.clicks     || 0), 0)
                const totSales   = progAffiliates.reduce((s, a) => s + (affStats[a.id]?.sales      || 0), 0)
                const totRev     = progAffiliates.reduce((s, a) => s + (affStats[a.id]?.revenue    || 0), 0)
                const totComm    = progAffiliates.reduce((s, a) => s + (affStats[a.id]?.commission || 0), 0)
                return (
                  <div key={prog.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 3 }}>{prog.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          {prog.commission_value}{prog.commission_type === 'percentage' ? '%' : '₹'} · {prog.commission_trigger.replace('_', ' ')} · {prog.attribution_window_days}d window · {progAffiliates.length} affiliates
                        </div>
                        {prog.description && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{prog.description}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setAnalyticsProgram(prog)} style={{ border: '0.5px solid var(--green)', color: 'var(--green)', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Analytics</button>
                        <button onClick={() => setEditProgram(prog)} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                        <button onClick={async () => {
                          await fetch(`/api/affiliate-programs/${prog.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_public: !prog.is_public }) })
                          setPrograms(prev => prev.map(p => p.id === prog.id ? { ...p, is_public: !prog.is_public } : p))
                        }} style={{ border: `0.5px solid ${prog.is_public ? 'var(--green)' : 'var(--border2)'}`, color: prog.is_public ? 'var(--green)' : 'var(--text-muted)', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          {prog.is_public ? '● Public' : '○ Private'}
                        </button>
                        <button onClick={() => setDeleteProgModal(prog)} style={{ border: '0.5px solid var(--border)', color: 'var(--text-dim)', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Delete</button>
                      </div>
                    </div>

                    {/* Program-level aggregate analytics */}
                    {progAffiliates.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                        {[
                          ['Clicks',  totClicks],
                          ['Sales',   totSales],
                          ['Revenue', `₹${(totRev/1000).toFixed(1)}k`],
                          ['Comm due', `₹${totComm.toFixed(0)}`],
                        ].map(([l, val]) => (
                          <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: '6px 4px' }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{val}</div>
                            <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Public join link */}
                    {prog.is_public && affiliateSlug && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 4, padding: '3px 7px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {baseUrl}/affiliate/join/{affiliateSlug}?program={prog.id}
                        </code>
                        <button onClick={() => { navigator.clipboard.writeText(`${baseUrl}/affiliate/join/${affiliateSlug}?program=${prog.id}`); setCopied(`prog-${prog.id}`); setTimeout(() => setCopied(null), 1500) }}
                          style={{ border: `0.5px solid ${copied === `prog-${prog.id}` ? 'var(--green)' : 'var(--border2)'}`, color: copied === `prog-${prog.id}` ? 'var(--green)' : 'var(--text-muted)', background: 'transparent', borderRadius: 5, padding: '4px 10px', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
                          {copied === `prog-${prog.id}` ? '✓' : 'Copy link'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {showNewProgram && <ProgramModal clientId={clientId} onClose={() => setShowNewProgram(false)} onSaved={p => setPrograms(prev => [p, ...prev])} />}
              {editProgram   && <ProgramModal clientId={clientId} existing={editProgram} onClose={() => setEditProgram(null)} onSaved={p => setPrograms(prev => prev.map(x => x.id === p.id ? p : x))} />}
              {analyticsProgram && <ProgramAnalyticsModal program={analyticsProgram} affiliates={affiliates} statsById={affStats} month={month} onClose={() => setAnalyticsProgram(null)} />}
            </div>
          )}

          {/* ── AMBASSADORS ── */}
          {subTab === 'ambassadors' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: '0.5px solid var(--border)', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
                {[
                  { label: 'Total',  value: ambassadors.length,                           color: 'var(--text-primary)' },
                  { label: 'Active', value: ambassadors.filter(a =>  a.is_active).length,  color: 'var(--green)' },
                  { label: 'Paused', value: ambassadors.filter(a => !a.is_active).length,  color: 'var(--amber)' },
                ].map((k, i) => (
                  <div key={k.label} style={{ padding: '14px 16px', background: 'var(--surface)', borderRight: i < 2 ? '0.5px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 6 }}>{k.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 500, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {['all', 'active', 'paused'].map(f => (
                    <button key={f} onClick={() => setStatusFilter(f)} style={{ padding: '4px 12px', borderRadius: 5, border: `0.5px solid ${statusFilter === f ? 'var(--amber)' : 'var(--border2)'}`, color: statusFilter === f ? 'var(--amber)' : 'var(--text-muted)', background: 'transparent', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
                  ))}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sort:</span>
                    {SORT_OPTIONS.map(o => (
                      <button key={o.value} onClick={() => setSort(o.value)} style={{ padding: '4px 10px', borderRadius: 5, border: `0.5px solid ${sort === o.value ? 'var(--green)' : 'var(--border2)'}`, background: 'transparent', color: sort === o.value ? 'var(--green)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>{o.label}</button>
                    ))}
                  </div>
                </div>
                <button onClick={() => window.open(`/api/export?type=ambassadors&clientId=${clientId}`, '_blank')} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>↓ Export CSV</button>
              </div>

              {filteredAmbassadors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No ambassadors {statusFilter !== 'all' ? `(${statusFilter})` : 'yet'}</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
                  {filteredAmbassadors.map(renderAffCard)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── FULL STATS MODAL ── */}
      {statsModal && (() => {
        const st = affStats[statsModal.id] || { clicks:0, sales:0, revenue:0, commission:0, conversionRate:0, codeRedemptions:0 }
        const v  = visitorMap[statsModal.id]
        const convRate = st.conversionRate ? st.conversionRate.toFixed(1) : (st.clicks > 0 ? (st.sales / st.clicks * 100).toFixed(1) : '0')
        return (
          <Modal title={`${statsModal.name} — Full stats`} onClose={() => setStatsModal(null)}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 8 }}>Performance</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
              {[
                ['Clicks',        st.clicks],
                ['Sales',         st.sales],
                ['Revenue',       `₹${st.revenue.toLocaleString('en-IN')}`],
                ['Commission',    `₹${st.commission.toFixed(0)}`],
                ['Conv rate',     `${convRate}%`],
                ['Code sales',    st.codeRedemptions ?? 0],
                ['Comm rate',     `${statsModal.commission_value}${statsModal.commission_type === 'percentage' ? '%' : '₹'}`],
                ['Trigger',       statsModal.commission_trigger.replace('_', ' ')],
                ['Attr window',   `${statsModal.attribution_window_days} days`],
              ].map(([l, val]) => (
                <div key={l as string} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>{val}</div>
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
              <div style={{ padding: '10px 0', fontSize: 11, color: 'var(--text-dim)' }}>Install beacon on your store to see visitor return/share data.</div>
            )}
          </Modal>
        )
      })()}

      {/* ── PAUSE MODAL ── */}
      {pauseModal && (
        <Modal title={`Pause ${pauseModal.name}?`} onClose={() => setPauseModal(null)} width={380}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Their link still works but clicks and sales won't be tracked.</p>
          <FormField label="Reason (internal, optional)">
            <Textarea value={pauseReason} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPauseReason(e.target.value)} placeholder="e.g. Account inactive…" />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setPauseModal(null)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={pause} style={{ background: 'transparent', border: '0.5px solid var(--amber)', color: 'var(--amber)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Pause</button>
          </div>
        </Modal>
      )}

      {/* ── DELETE AFFILIATE CONFIRM ── */}
      {deleteAffModal && (
        <Modal title={`Delete ${deleteAffModal.name}?`} onClose={() => setDeleteAffModal(null)} width={360}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>This will permanently remove the affiliate and their tracking link. All historical event data is preserved.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setDeleteAffModal(null)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={deleteAffiliate} style={{ background: 'transparent', border: '0.5px solid #e74c3c', color: '#e74c3c', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Delete</button>
          </div>
        </Modal>
      )}

      {/* ── DELETE PROGRAM CONFIRM ── */}
      {deleteProgModal && (
        <Modal title={`Delete "${deleteProgModal.name}"?`} onClose={() => setDeleteProgModal(null)} width={380}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Affiliates in this program will remain but their program link will be cleared. Historical data is preserved.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setDeleteProgModal(null)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={deleteProgram} style={{ background: 'transparent', border: '0.5px solid #e74c3c', color: '#e74c3c', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Delete</button>
          </div>
        </Modal>
      )}

      {/* ── EDIT AFFILIATE MODAL ── */}
      {editAffiliate && (
        <EditAffiliateModal
          affiliate={editAffiliate}
          programs={programs}
          campaigns={campaigns}
          onClose={() => setEditAffiliate(null)}
          onSaved={updated => { setAffiliates(prev => prev.map(a => a.id === updated.id ? updated : a)); setEditAffiliate(null) }}
        />
      )}
    </div>
  )
}
