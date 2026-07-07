'use client'
import { useState, useEffect, useRef } from 'react'
import Modal from './Modal'
import { FormField, Input, Select, Textarea, SubmitButton } from './FormFields'
import ChannelStatsBar from './ChannelStatsBar'
import { useCouponIntegrations, CouponStatusHint } from './CouponStatusHint'
import CartAbandonmentTab from './CartAbandonmentTab'

interface WAConfig { phone_number_id?: string; phone_display?: string; verified?: boolean; monthly_conversations_used?: number }
interface Template { id: string; template_name: string; status: string; body_text: string; header_text?: string; footer_text?: string; footer_text_raw?: string; variable_count: number; language: string; category: string; has_buttons: boolean; button_config?: { var_map?: Record<string, string>; button_text?: string; button_url?: string } }
interface Campaign { id: string; name: string; template_name: string; list_name: string; total_contacts: number; sent: number; delivered: number; read: number; clicked: number; sales: number; revenue: number; status: string; estimated_cost: number; sent_at?: string; tracking_slug: string; variable_map: any }
interface Props { clientId: string; campaigns: { id: string; name: string }[]; baseUrl: string; month?: string }

const STATUS_COLOR: Record<string, string> = {
  APPROVED: 'var(--green)', PENDING: 'var(--amber)', REJECTED: 'var(--red)', PAUSED: 'var(--text-dim)',
  sent: 'var(--green)', sending: 'var(--amber)', draft: 'var(--text-dim)', scheduled: 'var(--blue)', failed: 'var(--red)',
}

// Parse named variables like {{name}}, {{order_id}} from template text
function parseNamedVars(text: string): string[] {
  const matches = text.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g) || []
  // Deduplicate, preserve order
  return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))]
}

// Convert named vars to numbered: "Hi {{name}} use {{link}}" → "Hi {{1}} use {{2}}"
// Returns { converted, varMap: { "1": "name", "2": "link" } }
function convertToNumbered(text: string): { converted: string; varMap: Record<string, string> } {
  const vars = parseNamedVars(text)
  const varMap: Record<string, string> = {}
  let converted = text
  vars.forEach((v, i) => {
    varMap[String(i + 1)] = v
    converted = converted.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), `{{${i + 1}}}`)
  })
  return { converted, varMap }
}

// Pretty label for a var name
function varLabel(name: string): string {
  const labels: Record<string, string> = {
    name: 'Contact name', link: 'Tracking link (auto)', order_id: 'Order ID',
    address: 'Address', city: 'City', phone: 'Phone', email: 'Email',
    amount: 'Amount', date: 'Date', code: 'Discount code', brand: 'Brand name',
  }
  return labels[name] || name.replace(/_/g, ' ')
}

export default function WhatsAppDashboard({ clientId, campaigns, baseUrl, month }: Props) {
  const [subTab, setSubTab] = useState<'campaigns' | 'cart' | 'templates' | 'contacts' | 'settings'>('campaigns')
  const [config, setConfig] = useState<WAConfig>({})
  const [templates, setTemplates] = useState<Template[]>([])
  const [wayCampaigns, setWACampaigns] = useState<Campaign[]>([])
  const [contacts, setContacts] = useState<any>({ contacts: [], lists: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [statsModal, setStatsModal] = useState<Campaign | null>(null)
  const [statsData, setStatsData] = useState<any>(null)
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [showUploadContacts, setShowUploadContacts] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [selectedList, setSelectedList] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Settings form
  const [settingsForm, setSettingsForm] = useState({ phone_number_id: '', access_token: '', waba_id: '' })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')

  // New campaign form
  const [campForm, setCampForm] = useState<any>({ name: '', template_id: '', template_name: '', list_name: '', variable_map: {}, campaign_id: '' })
  const [campLoading, setCampLoading] = useState(false)
  const [campError, setCampError] = useState('')
  const [previewVars, setPreviewVars] = useState<string[]>([])

  // New template form
  const [tmplForm, setTmplForm] = useState({ name: '', category: 'MARKETING', language: 'en', headerType: 'TEXT', headerText: '', headerMediaId: '', headerMediaName: '', headerMediaPreview: '', bodyText: '', footerText: '', buttonText: '', buttonUrl: '' })
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const couponIntegrations = useCouponIntegrations()
  const [tmplLoading, setTmplLoading] = useState(false)
  const [tmplError, setTmplError] = useState('')

  // Upload contacts form
  const [uploadForm, setUploadForm] = useState({ list_name: '', opted_in_confirmed: false })
  const [uploadData, setUploadData] = useState<any[]>([])
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const load = async () => {
    setLoading(true)
    const [cfgRes, tmplRes, campRes, ctcRes] = await Promise.all([
      fetch('/api/whatsapp/connect'),
      fetch('/api/whatsapp/templates'),
      fetch(`/api/whatsapp/campaigns?month=${month || new Date().toISOString().slice(0,7)}`),
      fetch('/api/whatsapp/contacts'),
    ])
    const [cfg, tmpls, camps, ctc] = await Promise.all([cfgRes.json(), tmplRes.json(), campRes.json(), ctcRes.json()])
    setConfig(cfg || {})
    setTemplates(Array.isArray(tmpls) ? tmpls : [])
    setWACampaigns(Array.isArray(camps) ? camps : [])
    setContacts(ctc || { contacts: [], lists: [], total: 0 })
    setLoading(false)
  }

  useEffect(() => { load() }, [month])

  const connectWA = async (e: React.FormEvent) => {
    e.preventDefault()
    setSettingsSaving(true); setSettingsError(''); setSettingsSuccess('')
    const res = await fetch('/api/whatsapp/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsForm) })
    const data = await res.json()
    setSettingsSaving(false)
    if (!res.ok) { setSettingsError(data.error); return }
    setSettingsSuccess(`Connected: ${data.display}. ${data.templateCount} templates synced.`)
    setConfig({ ...config, verified: true, phone_display: data.display })
    setTemplates(prev => prev.length ? prev : [])
    load()
  }

  const syncTemplates = async () => {
    setSyncing(true)
    const res = await fetch('/api/whatsapp/templates?sync=1')
    const data = await res.json()
    setSyncing(false)
    if (res.ok) load()
    else alert(data.error)
  }

  const sendCampaign = async (id: string) => {
    if (!confirm('Send this campaign to all contacts now? This cannot be undone.')) return
    setSendingId(id)
    const res = await fetch(`/api/whatsapp/campaigns/${id}/send`, { method: 'POST' })
    const data = await res.json()
    setSendingId(null)
    if (!res.ok) { alert(data.error); return }
    alert(`✓ Sent to ${data.sent} contacts. ${data.errors} errors.`)
    load()
  }

  const openStats = async (camp: Campaign) => {
    setStatsModal(camp)
    const res = await fetch(`/api/whatsapp/campaigns/${camp.id}/stats`)
    const data = await res.json()
    setStatsData(data)
  }

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    setCampLoading(true); setCampError('')
    const res = await fetch('/api/whatsapp/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...campForm, clientId }) })
    const data = await res.json()
    setCampLoading(false)
    if (!res.ok) { setCampError(data.error); return }
    setWACampaigns(prev => [data, ...prev])
    setShowNewCampaign(false)
    setCampForm({ name: '', template_id: '', template_name: '', list_name: '', variable_map: {}, campaign_id: '' })
  }

  const createTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    setTmplLoading(true); setTmplError('')
    // Convert named vars {{name}} → {{1}} for Meta, store var_map for display
    const { converted: convertedBody, varMap } = convertToNumbered(tmplForm.bodyText)
    const hasNamedVars = Object.keys(varMap).length > 0
    const payload = {
      ...tmplForm,
      bodyText: convertedBody,
      trackingBase: tmplForm.buttonUrl ? `${baseUrl}/r` : undefined,
      exampleSlug: 'example-campaign',
      button_config: {
        ...(hasNamedVars ? { var_map: varMap } : {}),
        ...(tmplForm.buttonText ? { button_text: tmplForm.buttonText } : {}),
        ...(tmplForm.buttonUrl  ? { button_url:  tmplForm.buttonUrl  } : {}),
      },
      original_body: hasNamedVars ? tmplForm.bodyText : undefined,
    }
    const res = await fetch('/api/whatsapp/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    setTmplLoading(false)
    if (!res.ok) { setTmplError(data.error); return }
    setTemplates(prev => [data, ...prev])
    setShowNewTemplate(false)
  }

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) return
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/"/g, ''))
        const obj: any = {}
        headers.forEach((h, i) => { obj[h] = vals[i] || '' })
        return obj
      }).filter(r => r.phone || r.Phone || r.mobile || r.Mobile)
      setUploadData(rows)
    }
    reader.readAsText(file)
  }

  const uploadContacts = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!uploadData.length) { setUploadError('Please select a CSV file first'); return }
    if (!uploadForm.opted_in_confirmed) { setUploadError('You must confirm opt-in consent'); return }
    setUploadLoading(true); setUploadError('')
    const res = await fetch('/api/whatsapp/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...uploadForm, contacts: uploadData }),
    })
    const data = await res.json()
    setUploadLoading(false)
    if (!res.ok) { setUploadError(data.error); return }
    setShowUploadContacts(false)
    setUploadData([]); setUploadForm({ list_name: '', opted_in_confirmed: false })
    load()
  }

  // Preview template text
  const getPreview = (template: Template | undefined, vars: string[]) => {
    if (!template) return ''
    let text = template.body_text
    vars.forEach((v, i) => { text = text.replace(new RegExp(`\\{\\{${i+1}\\}\\}`, 'g'), v || `{{${i+1}}}`) })
    return text
  }

  const selectedTemplate = templates.find(t => t.template_name === campForm.template_name)

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
      {[1,2,3].map(i => <div key={i} style={{ height: 100, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, opacity: 0.4 }} />)}
    </div>
  )

  const isConnected = config.verified

  return (
    <div>
      {/* Not connected banner */}
      {!isConnected && (
        <div style={{ background: 'var(--amber-bg)', border: '0.5px solid var(--amber-border)', borderRadius: 9, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--amber)', marginBottom: 3 }}>WhatsApp not connected</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Connect your Meta WhatsApp Business API to start sending campaigns directly from Korant.</div>
          </div>
          <button onClick={() => setSubTab('settings')} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Connect now →</button>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: 20 }}>
        {[
          ['campaigns', `Campaigns (${wayCampaigns.length})`],
          ['cart', 'Cart Abandonment'],
          ['templates', `Templates (${templates.length})`],
          ['contacts', `Contacts (${contacts.total || 0})`],
          ['settings', isConnected ? '✓ Connected' : 'Settings'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id as any)} style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: `1.5px solid ${subTab === id ? 'var(--green)' : 'transparent'}`, color: subTab === id ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {/* ── CAMPAIGNS ── */}
      {subTab === 'campaigns' && (
        <div>
          {/* Always-visible stats bar — shows zeros when no data */}
          {(() => {
            const sent      = wayCampaigns.reduce((s,w) => s + (w.sent      ||0), 0)
            const delivered = wayCampaigns.reduce((s,w) => s + (w.delivered ||0), 0)
            const read      = wayCampaigns.reduce((s,w) => s + (w.read      ||0), 0)
            const clicked   = wayCampaigns.reduce((s,w) => s + (w.clicked   ||0), 0)
            const sales     = wayCampaigns.reduce((s,w) => s + (w.sales     ||0), 0)
            const revenue   = wayCampaigns.reduce((s: number,w: any) => s + (Number(w.revenue)||0), 0)
            const dlvRate   = sent > 0 ? ((delivered/sent)*100).toFixed(0) : '0'
            const readRate  = sent > 0 ? ((read/sent)*100).toFixed(0)      : '0'
            const clickRate = sent > 0 ? ((clicked/sent)*100).toFixed(0)   : '0'
            const kpis = [
              { label: 'Messages sent',  value: sent.toLocaleString('en-IN'),                   color: 'var(--text-primary)', sub: null },
              { label: 'Delivered',      value: delivered.toLocaleString('en-IN'),              color: '#25d366',             sub: `${dlvRate}%`   },
              { label: 'Read',           value: read.toLocaleString('en-IN'),                   color: '#53bdeb',             sub: `${readRate}%`  },
              { label: 'Clicked',        value: clicked.toLocaleString('en-IN'),                color: 'var(--amber)',        sub: `${clickRate}%` },
              { label: 'Sales',          value: sales.toLocaleString('en-IN'),                  color: 'var(--green)',        sub: null },
              { label: 'Revenue',        value: `₹${(revenue/1000).toFixed(1)}k`,              color: 'var(--amber)',        sub: null },
            ]
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', marginBottom: 0, marginLeft: -24, marginRight: -24, borderBottom: '0.5px solid var(--border)' }}>
                {kpis.map((k, i) => (
                  <div key={k.label} style={{ padding: '14px 20px', borderRight: i < 5 ? '0.5px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 6 }}>{k.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: k.color, lineHeight: 1 }}>{k.value}</div>
                    {k.sub && <div style={{ fontSize: 10, color: k.color, opacity: 0.7, marginTop: 3 }}>{k.sub} rate</div>}
                  </div>
                ))}
              </div>
            )
          })()}
          {/* Mini charts row */}
          {(() => {
            const sent      = wayCampaigns.reduce((s,w) => s + (w.sent      ||0), 0)
            const delivered = wayCampaigns.reduce((s,w) => s + (w.delivered ||0), 0)
            const read      = wayCampaigns.reduce((s,w) => s + (w.read      ||0), 0)
            const clicked   = wayCampaigns.reduce((s,w) => s + (w.clicked   ||0), 0)
            const sales     = wayCampaigns.reduce((s,w) => s + (w.sales     ||0), 0)
            const revenue   = wayCampaigns.reduce((s: number,w: any) => s + (Number(w.revenue)||0), 0)
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: '16px 0', borderBottom: '0.5px solid var(--border)', marginBottom: 20 }}>
                {/* Delivery funnel */}
                <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 12 }}>Delivery funnel</div>
                  {[
                    { label: 'Sent',      value: sent,      color: 'var(--border2)' },
                    { label: 'Delivered', value: delivered, color: '#25d366' },
                    { label: 'Read',      value: read,      color: '#53bdeb' },
                    { label: 'Clicked',   value: clicked,   color: 'var(--amber)' },
                  ].map(row => {
                    const pct = sent > 0 ? (row.value / sent) * 100 : 0
                    return (
                      <div key={row.label} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.label}</span>
                          <span style={{ fontSize: 11, color: row.color }}>{row.value.toLocaleString('en-IN')}{sent > 0 ? ` (${pct.toFixed(0)}%)` : ''}</span>
                        </div>
                        <div style={{ height: 3, background: 'var(--border3)', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${Math.max(pct, sent > 0 ? 1 : 0)}%`, background: row.color, borderRadius: 2, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                    )
                  })}
                  {sent === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', paddingTop: 8 }}>No campaigns sent yet</div>}
                </div>
                {/* Revenue + Sales */}
                <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 12 }}>Conversion</div>
                  {[
                    { label: 'Revenue attributed',   value: `₹${(revenue/1000).toFixed(1)}k`,                      color: 'var(--amber)' },
                    { label: 'Sales',                 value: sales.toLocaleString('en-IN'),                          color: 'var(--green)' },
                    { label: 'Click → sale rate',     value: clicked > 0 ? `${((sales/clicked)*100).toFixed(1)}%` : '—', color: 'var(--text-secondary)' },
                    { label: 'Revenue per message',   value: sent > 0 ? `₹${(revenue/sent).toFixed(2)}` : '—',      color: 'var(--text-secondary)' },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 8, borderBottom: '0.5px solid var(--border3)' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: row.color }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                {/* Per-campaign breakdown */}
                <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 12 }}>Campaigns</div>
                  {wayCampaigns.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', paddingTop: 8 }}>No campaigns yet</div>
                  ) : wayCampaigns.slice(0,4).map((w: any) => (
                    <div key={w.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '0.5px solid var(--border3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>{w.name}</span>
                        <span style={{ fontSize: 10, color: w.status === 'sent' ? 'var(--green)' : w.status === 'sending' ? 'var(--amber)' : 'var(--text-dim)' }}>● {w.status}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                        {(w.sent||0).toLocaleString()} sent · {(w.clicked||0)} clicked · ₹{((Number(w.revenue)||0)/1000).toFixed(0)}k
                      </div>
                    </div>
                  ))}
                  {wayCampaigns.length > 4 && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>+{wayCampaigns.length - 4} more campaigns</div>}
                </div>
              </div>
            )
          })()}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={() => setShowNewCampaign(true)} disabled={!isConnected} style={{ border: '0.5px solid var(--green)', color: 'var(--green)', background: 'transparent', borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.4 }}>+ New campaign</button>
          </div>

          {wayCampaigns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>No WhatsApp campaigns yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 360, margin: '0 auto 16px' }}>Create a campaign, pick a template and a contact list, and send directly from Korant — no Wati or Interakt needed.</div>
              {isConnected && <button onClick={() => setShowNewCampaign(true)} style={{ border: '0.5px solid var(--green)', color: 'var(--green)', background: 'transparent', borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Create first campaign</button>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {wayCampaigns.map(camp => (
                <div key={camp.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 3 }}>{camp.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        Template: <span style={{ color: 'var(--text-muted)' }}>{camp.template_name}</span>
                        {' · '}List: <span style={{ color: 'var(--text-muted)' }}>{camp.list_name}</span>
                        {camp.sent_at && <> · Sent {new Date(camp.sent_at).toLocaleDateString('en-IN')}</>}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: STATUS_COLOR[camp.status] || 'var(--text-dim)', background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 4, padding: '2px 8px' }}>{camp.status}</span>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 12 }}>
                    {[
                      ['Contacts',  camp.total_contacts || 0],
                      ['Sent',      camp.sent || 0],
                      ['Delivered', camp.delivered || 0],
                      ['Read',      camp.read || 0],
                      ['Clicked',   camp.clicked || 0],
                      ['Sales',     camp.sales || 0],
                      ['Revenue',   `₹${((camp.revenue as any) || 0).toLocaleString('en-IN')}`],
                    ].map(([l, v]) => (
                      <div key={l as string} style={{ textAlign: 'center', background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 5, padding: '7px 4px' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{v}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: 2 }}>{l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Delivery bar */}
                  {camp.sent > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ height: 4, background: 'var(--border3)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${(camp.delivered / camp.sent) * 100}%`, background: 'var(--green)', borderRadius: '2px 0 0 2px' }} />
                        <div style={{ width: `${Math.max(0, (camp.sent - camp.delivered) / camp.sent * 100)}%`, background: 'var(--border2)' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: 'var(--green)' }}>{camp.sent > 0 ? ((camp.delivered / camp.sent) * 100).toFixed(0) : 0}% delivered</span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Est. cost: ₹{camp.estimated_cost || 0}</span>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => openStats(camp)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>View stats</button>
                    {(camp.status === 'draft' || camp.status === 'scheduled') && (
                      <button
                        onClick={() => sendCampaign(camp.id)}
                        disabled={sendingId === camp.id || !isConnected}
                        style={{ background: 'transparent', border: '0.5px solid var(--green)', color: 'var(--green)', borderRadius: 6, padding: '5px 14px', fontSize: 11, cursor: 'pointer', opacity: sendingId === camp.id ? 0.6 : 1 }}
                      >
                        {sendingId === camp.id ? 'Sending…' : `Send to ${camp.total_contacts} contacts`}
                      </button>
                    )}
                    <a href={`${baseUrl}/r/${camp.tracking_slug}`} target="_blank" rel="noopener noreferrer" style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 12px', fontSize: 11, textDecoration: 'none' }}>Tracking link ↗</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TEMPLATES ── */}
      {subTab === 'cart' && <CartAbandonmentTab templates={templates} month={month} />}

      {subTab === 'templates' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              WhatsApp requires pre-approved templates for outbound messages.
              {isConnected && <> Approval takes 24-48h from Meta.</>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isConnected && <button onClick={syncTemplates} disabled={syncing} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>{syncing ? 'Syncing…' : '↻ Sync from Meta'}</button>}
              <button onClick={() => setShowNewTemplate(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>+ New template</button>
            </div>
          </div>

          {templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
              <div style={{ fontSize: 20, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 8 }}>No templates yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 360, margin: '0 auto 16px' }}>Create a template and submit it to Meta for approval. Use &#123;&#123;1&#125;&#125; &#123;&#123;2&#125;&#125; for dynamic variables like name and link.</div>
              <button onClick={() => setShowNewTemplate(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Create template</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {templates.map(t => (
                <div key={t.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{t.template_name}</div>
                    <span style={{ fontSize: 10, color: STATUS_COLOR[t.status] || 'var(--text-dim)', background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 4, padding: '2px 7px' }}>{t.status}</span>
                  </div>
                  {/* Mini WhatsApp bubble preview */}
                  <div style={{ background: '#202c33', borderRadius: '10px 0 10px 10px', overflow: 'hidden', marginBottom: 10 }}>
                    {t.header_text && (
                      <div style={{ padding: '8px 10px 3px', fontSize: 12, fontWeight: 700, color: '#e9edef', lineHeight: 1.4 }}>{t.header_text}</div>
                    )}
                    <div style={{ padding: t.header_text ? '2px 10px 6px' : '8px 10px 6px', fontSize: 11, color: '#e9edef', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>
                      {(t.body_text || '').replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1')}
                    </div>
                    {t.footer_text && <div style={{ padding: '0 10px 5px', fontSize: 10, color: '#8696a0' }}>{t.footer_text}</div>}
                    {t.has_buttons && t.button_config?.button_text && (
                      <div style={{ borderTop: '0.5px solid #2a3942', padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <span style={{ fontSize: 11, color: '#53bdeb', fontWeight: 500 }}>{t.button_config.button_text}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t.category} · {t.language}</span>
                    {t.variable_count > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      · {t.button_config?.var_map
                        ? Object.values(t.button_config.var_map).map((v: any) => `{{${v}}}`).join(', ')
                        : `${t.variable_count} variable${t.variable_count > 1 ? 's' : ''}`}
                    </span>
                  )}
                    {t.status === 'APPROVED' && <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 'auto' }}>Ready to use</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CONTACTS ── */}
      {subTab === 'contacts' && (
        <div>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedList && (
                <button onClick={() => setSelectedList(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>
              )}
              <div>
                {selectedList
                  ? <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{selectedList}</span>
                  : <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{contacts.total || 0} opted-in contacts across {contacts.lists?.length || 0} lists</span>
                }
              </div>
            </div>
            <button onClick={() => setShowUploadContacts(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>↑ Upload CSV</button>
          </div>

          {contacts.lists?.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, border: '0.5px dashed var(--border2)', borderRadius: 10 }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>👥</div>
              <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 8 }}>No contact lists yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 380, margin: '0 auto 16px', lineHeight: 1.7 }}>
                Upload up to 5 different CSVs — each with a name like "Diwali Customers" or "VIP Members". When sending a campaign you pick exactly which list to send to.
              </div>
              <button onClick={() => setShowUploadContacts(true)} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Upload first list</button>
            </div>
          ) : !selectedList ? (
            /* ── List grid view ── */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {contacts.lists?.map((listName: string) => {
                const listContacts = contacts.contacts?.filter((c: any) => c.list_name === listName) || []
                const campaignsUsed = wayCampaigns.filter(c => c.list_name === listName).length
                return (
                  <div
                    key={listName}
                    onClick={() => setSelectedList(listName)}
                    style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18, cursor: 'pointer', transition: 'border-color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--amber)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--surface2)', border: '0.5px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👥</div>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 4, padding: '2px 7px' }}>
                        {campaignsUsed} campaign{campaignsUsed !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>{listName}</div>
                    <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>{listContacts.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>opted-in contacts</div>
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--border3)', display: 'flex', gap: 6 }}>
                      <button
                        onClick={e => { e.stopPropagation(); setCampForm((f: any) => ({ ...f, list_name: listName })); setSubTab('campaigns'); setShowNewCampaign(true) }}
                        style={{ flex: 1, background: 'transparent', border: '0.5px solid var(--green)', color: 'var(--green)', borderRadius: 5, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}
                      >
                        Send campaign →
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedList(listName) }}
                        style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 5, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                      >
                        View
                      </button>
                    </div>
                  </div>
                )
              })}
              {/* Upload new list card */}
              <div
                onClick={() => setShowUploadContacts(true)}
                style={{ background: 'transparent', border: '0.5px dashed var(--border2)', borderRadius: 10, padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 160 }}
              >
                <div style={{ fontSize: 24, color: 'var(--text-dim)' }}>+</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>Upload new list</div>
              </div>
            </div>
          ) : (
            /* ── Individual list detail view ── */
            (() => {
              const listContacts = contacts.contacts?.filter((c: any) => c.list_name === selectedList) || []
              const campaignsUsed = wayCampaigns.filter(c => c.list_name === selectedList)
              return (
                <div>
                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
                    {[
                      ['Contacts', listContacts.length, 'var(--text-primary)'],
                      ['Campaigns sent', campaignsUsed.length, 'var(--green)'],
                      ['Total messages', campaignsUsed.reduce((s: number, c: any) => s + (c.sent || 0), 0), 'var(--amber)'],
                    ].map(([l,v,c]) => (
                      <div key={l as string} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 6 }}>{l}</div>
                        <div style={{ fontSize: 20, fontWeight: 500, color: c as string }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <button
                      onClick={() => { setCampForm((f: any) => ({ ...f, list_name: selectedList })); setSubTab('campaigns'); setShowNewCampaign(true) }}
                      style={{ border: '0.5px solid var(--green)', color: 'var(--green)', background: 'transparent', borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer' }}
                    >
                      Send campaign to this list →
                    </button>
                    <button
                      onClick={() => { setUploadForm(f => ({ ...f, list_name: selectedList! })); setShowUploadContacts(true) }}
                      style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer' }}
                    >
                      + Add more contacts
                    </button>
                  </div>

                  {/* Contacts table */}
                  <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Name', 'Phone', 'Opted in', 'Added'].map(h => (
                            <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', padding: '10px 14px', textAlign: 'left', borderBottom: '0.5px solid var(--border)', fontWeight: 400 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {listContacts.slice(0, 100).map((c: any) => (
                          <tr key={c.id}>
                            <td style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '9px 14px', borderBottom: '0.5px solid var(--border3)' }}>{c.name || '—'}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)', padding: '9px 14px', borderBottom: '0.5px solid var(--border3)', fontFamily: 'monospace' }}>+{c.phone}</td>
                            <td style={{ padding: '9px 14px', borderBottom: '0.5px solid var(--border3)' }}>
                              <span style={{ fontSize: 10, color: 'var(--green)', background: 'var(--green-bg)', border: '0.5px solid var(--green-border)', borderRadius: 3, padding: '1px 6px' }}>✓ Yes</span>
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--text-dim)', padding: '9px 14px', borderBottom: '0.5px solid var(--border3)' }}>{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {listContacts.length > 100 && (
                      <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-dim)', borderTop: '0.5px solid var(--border)' }}>
                        Showing 100 of {listContacts.length} contacts
                      </div>
                    )}
                  </div>
                </div>
              )
            })()
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {subTab === 'settings' && (
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>WhatsApp Business API</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.7 }}>
            Connect your Meta WhatsApp Business Cloud API. You need a Meta Business account, a verified WhatsApp Business number, and an access token from the Meta Developer dashboard.
          </p>

          {isConnected && (
            <div style={{ background: 'var(--green-bg)', border: '0.5px solid var(--green-border)', borderRadius: 8, padding: 14, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--green)', fontSize: 16 }}>✓</span>
              <div>
                <div style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>Connected</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{config.phone_display}</div>
              </div>
              <button onClick={async () => { await fetch('/api/whatsapp/connect', { method: 'DELETE' }); setConfig({}); load() }} style={{ marginLeft: 'auto', border: '0.5px solid var(--red)', color: 'var(--red)', background: 'transparent', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Disconnect</button>
            </div>
          )}

          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 16 }}>How to get these values</div>
            {[
              ['1. Create Meta app', 'developers.facebook.com → Create App → Business → Add WhatsApp product'],
              ['2. Get Phone Number ID', 'WhatsApp → API Setup → Phone number ID (the long number)'],
              ['3. Get Access Token', 'System Users in Business Manager → Generate token with whatsapp_business_messaging permission'],
              ['4. Get WABA ID (optional)', 'WhatsApp → API Setup → WhatsApp Business Account ID — needed to submit new templates'],
            ].map(([step, desc]) => (
              <div key={step} style={{ display: 'flex', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: '0.5px solid var(--border3)' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--amber)', flexShrink: 0, width: 120 }}>{step}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>

          <form onSubmit={connectWA} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 20 }}>
            <FormField label="Phone Number ID" required>
              <Input value={settingsForm.phone_number_id} onChange={e => setSettingsForm(f => ({ ...f, phone_number_id: e.target.value }))} placeholder="103xxxxxxxxxxxxx" required />
            </FormField>
            <FormField label="Access Token" required>
              <Input type="password" value={settingsForm.access_token} onChange={e => setSettingsForm(f => ({ ...f, access_token: e.target.value }))} placeholder="EAAxxxxxxxx..." required />
            </FormField>
            <FormField label="WABA ID (optional — needed to submit new templates)">
              <Input value={settingsForm.waba_id} onChange={e => setSettingsForm(f => ({ ...f, waba_id: e.target.value }))} placeholder="101xxxxxxxx" />
            </FormField>
            {settingsError && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{settingsError}</div>}
            {settingsSuccess && <div style={{ color: 'var(--green)', fontSize: 12, marginBottom: 12 }}>{settingsSuccess}</div>}
            <SubmitButton loading={settingsSaving} label="Connect & verify" loadingLabel="Verifying…" />
          </form>

          <div style={{ marginTop: 20, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 10 }}>Webhook URL for Meta</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Add this URL in Meta Developer Console → WhatsApp → Configuration → Webhook URL:</div>
            <code style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 5, padding: '6px 10px', display: 'block', wordBreak: 'break-all', marginBottom: 8 }}>
              {baseUrl}/api/webhook/whatsapp
            </code>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Verify token: <code style={{ color: 'var(--amber)' }}>{process.env.NEXT_PUBLIC_WA_VERIFY_TOKEN || 'korant-wa-verify'}</code></div>
          </div>
        </div>
      )}

      {/* ── NEW CAMPAIGN MODAL ── */}
      {showNewCampaign && (
        <Modal title="New WhatsApp campaign" onClose={() => setShowNewCampaign(false)} width={520}>
          <form onSubmit={createCampaign}>
            <FormField label="Campaign name" required>
              <Input value={campForm.name} onChange={e => setCampForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="Diwali Sale 2025" required />
            </FormField>
            <FormField label="Template" required>
              <Select value={campForm.template_name} onChange={e => {
                const t = templates.find(t => t.template_name === e.target.value)
                setCampForm((f: any) => ({ ...f, template_name: e.target.value, template_id: t?.id || '', variable_map: {} }))
                if (t) setPreviewVars(Array(t.variable_count).fill(''))
              }} options={[
                { value: '', label: 'Select a template…' },
                ...templates.filter(t => t.status === 'APPROVED').map(t => ({ value: t.template_name, label: `${t.template_name} (${t.language})` })),
              ]} required />
            </FormField>

            {/* Variable mapping */}
            {selectedTemplate && selectedTemplate.variable_count > 0 && (
              <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Map variables to contact data or fixed values</div>
                {Array.from({ length: selectedTemplate.variable_count }, (_, i) => {
                  const varMap = selectedTemplate.button_config?.var_map || {}
                  const namedVar = varMap[String(i + 1)]
                  // Auto-map known named vars
                  const autoValue = namedVar === 'link' ? '__link__'
                    : namedVar === 'name' ? '__name__'
                    : campForm.variable_map[`{{${i+1}}}`] || ''
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 12, color: 'var(--amber)', fontFamily: 'monospace' }}>{`{{${i+1}}}`}</span>
                        {namedVar && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>→ {namedVar}</span>}
                      </div>
                      <Select
                        value={autoValue}
                        onChange={e => setCampForm((f: any) => ({ ...f, variable_map: { ...f.variable_map, [`{{${i+1}}}`]: e.target.value } }))}
                        options={[
                          { value: '__name__',   label: '👤 Contact name' },
                          { value: '__link__',   label: '🔗 Tracking link (auto)' },
                          { value: '__custom__', label: '📋 Custom (from CSV column)' },
                          { value: '__blank__',  label: '— Leave blank' },
                        ]}
                      />
                    </div>
                  )
                })}
                {/* Preview */}
                <div style={{ marginTop: 10, padding: 10, background: 'var(--surface)', border: '0.5px solid var(--border3)', borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 5 }}>PREVIEW</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {getPreview(selectedTemplate, Array.from({ length: selectedTemplate.variable_count }, (_, i) => {
                      const val = campForm.variable_map[`{{${i+1}}}`]
                      const varMap = selectedTemplate.button_config?.var_map || {}
                      const namedVar = varMap[String(i + 1)]
                      // Auto-fill previews for known named vars
                      const effective = val || (namedVar === 'link' ? '__link__' : namedVar === 'name' ? '__name__' : '')
                      if (effective === '__name__') return 'Priya'
                      if (effective === '__link__') return `${baseUrl}/r/wa-preview`
                      if (effective === '__custom__') return `[${namedVar || 'custom'}]`
                      return namedVar ? `[${namedVar}]` : `[var${i+1}]`
                    }))}
                  </div>
                </div>
              </div>
            )}

            <FormField label="Contact list" required>
              <Select value={campForm.list_name} onChange={e => setCampForm((f: any) => ({ ...f, list_name: e.target.value }))} options={[
                { value: '', label: 'Select a list…' },
                ...(contacts.lists || []).map((l: string) => ({ value: l, label: l })),
              ]} required />
            </FormField>
            {campForm.list_name && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
                {(contacts.contacts || []).filter((c: any) => c.list_name === campForm.list_name).length} opted-in contacts in this list
              </div>
            )}
            <FormField label="Campaign" required hint="Stats roll up into this campaign in your overview dashboard">
              <Select value={campForm.campaign_id} onChange={e => setCampForm((f: any) => ({ ...f, campaign_id: e.target.value }))} options={[{ value: '', label: 'Select a campaign…' }, ...campaigns.map(cc => ({ value: cc.id, label: cc.name }))]} required />
            </FormField>
            {campError && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{campError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setShowNewCampaign(false)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <SubmitButton loading={campLoading} label="Create campaign" color="green" />
            </div>
          </form>
        </Modal>
      )}

      {/* ── NEW TEMPLATE MODAL ── */}
      {showNewTemplate && (
        <Modal title="New message template" onClose={() => setShowNewTemplate(false)} width={600}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* ── Left: Form ── */}
            <div>
              <div style={{ background: 'var(--amber-bg)', border: '0.5px solid var(--amber-border)', borderRadius: 7, padding: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 3, fontWeight: 500 }}>Meta approval required</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Templates reviewed in 24-48h. Use <code>*bold*</code> <code>_italic_</code> for formatting.</div>
              </div>

              <form onSubmit={createTemplate}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Template name *</label>
                    <input value={tmplForm.name} onChange={e => setTmplForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g,'_') }))} placeholder="event_passes_2025" required style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', padding: '7px 10px', width: '100%', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Category</label>
                    <select value={tmplForm.category} onChange={e => setTmplForm(f => ({ ...f, category: e.target.value }))} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', padding: '7px 10px', width: '100%', outline: 'none' }}>
                      <option value="MARKETING">Marketing</option>
                      <option value="UTILITY">Utility</option>
                      <option value="AUTHENTICATION">Authentication</option>
                    </select>
                  </div>
                </div>

                {/* Header */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Header (optional)</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {['TEXT','IMAGE','VIDEO','DOCUMENT'].map(t => (
                      <button key={t} onClick={() => setTmplForm(f => ({ ...f, headerType: t, headerText: '', headerMediaId: '', headerMediaName: '', headerMediaPreview: '' }))}
                        style={{ fontSize: 10, padding: '4px 10px', borderRadius: 5, border: '0.5px solid var(--border2)', background: tmplForm.headerType === t ? 'var(--amber)' : 'transparent', color: tmplForm.headerType === t ? '#000' : 'var(--text-muted)', cursor: 'pointer' }}>{t}</button>
                    ))}
                  </div>
                  {tmplForm.headerType === 'TEXT' && (
                    <input value={tmplForm.headerText} onChange={e => setTmplForm(f => ({ ...f, headerText: e.target.value }))} placeholder="We've Announced 3 New Passes:" style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', padding: '7px 10px', width: '100%', outline: 'none' }} />
                  )}
                  {tmplForm.headerType !== 'TEXT' && (
                    <div>
                      <input type="file" accept={tmplForm.headerType === 'IMAGE' ? 'image/jpeg,image/png,image/webp' : tmplForm.headerType === 'VIDEO' ? 'video/mp4' : 'application/pdf'} style={{ display: 'none' }} id="wa-media-upload"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]; if (!file) return
                          setUploadingMedia(true)
                          const reader = new FileReader()
                          reader.onload = async (ev) => {
                            const base64 = (ev.target?.result as string).split(',')[1]
                            const res = await fetch('/api/whatsapp/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileBase64: base64, mimeType: file.type, fileName: file.name }) })
                            const data = await res.json()
                            if (data.media_id) {
                              const preview = tmplForm.headerType === 'IMAGE' ? ev.target?.result as string : ''
                              setTmplForm(f => ({ ...f, headerMediaId: data.media_id, headerMediaName: file.name, headerMediaPreview: preview }))
                            } else { alert('Upload failed: ' + (data.error || 'Unknown')) }
                            setUploadingMedia(false)
                          }
                          reader.readAsDataURL(file)
                        }}
                      />
                      <label htmlFor="wa-media-upload" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, cursor: uploadingMedia ? 'wait' : 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
                        {uploadingMedia ? '⏳ Uploading...' : tmplForm.headerMediaName ? `✓ ${tmplForm.headerMediaName}` : `📎 Upload ${tmplForm.headerType.toLowerCase()}`}
                      </label>
                      {tmplForm.headerMediaPreview && <img src={tmplForm.headerMediaPreview} alt="preview" style={{ marginTop: 8, maxWidth: '100%', maxHeight: 100, borderRadius: 6, objectFit: 'cover', display: 'block' }} />}
                      {!tmplForm.headerMediaPreview && tmplForm.headerMediaId && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--green)' }}>✓ Uploaded to Meta</div>}
                    </div>
                  )}
                </div>

                {/* Body with formatting toolbar */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Body text *</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[
                        { icon: 'B', title: 'Bold — wrap with *asterisks*',    wrap: ['*','*'] },
                        { icon: 'I', title: 'Italic — wrap with _underscores_', wrap: ['_','_'] },
                        { icon: '•', title: 'Bullet point',                     insert: '• ' },
                        { icon: '{}', title: 'Named variable',                  insert: '{{name}}' },
                      ].map(btn => (
                        <button key={btn.icon} type="button" title={btn.title}
                          onClick={() => {
                            const ta = document.getElementById('wa-body-ta') as HTMLTextAreaElement
                            if (!ta) return
                            const start = ta.selectionStart, end = ta.selectionEnd
                            const sel = ta.value.slice(start, end)
                            let inserted = ''
                            if (btn.wrap) inserted = btn.wrap[0] + (sel || 'text') + btn.wrap[1]
                            else inserted = (btn.insert || '') + sel
                            const newVal = ta.value.slice(0, start) + inserted + ta.value.slice(end)
                            setTmplForm(f => ({ ...f, bodyText: newVal }))
                            setTimeout(() => { ta.focus(); ta.setSelectionRange(start + inserted.length, start + inserted.length) }, 0)
                          }}
                          style={{ background: 'var(--surface)', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 4, padding: '2px 7px', fontSize: btn.icon === 'B' ? 11 : btn.icon === 'I' ? 11 : 12, cursor: 'pointer', fontWeight: btn.icon === 'B' ? 700 : 400, fontStyle: btn.icon === 'I' ? 'italic' : 'normal' }}
                        >{btn.icon}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    id="wa-body-ta"
                    value={tmplForm.bodyText}
                    onChange={e => setTmplForm(f => ({ ...f, bodyText: e.target.value }))}
                    placeholder={"We've Announced 3 New Passes:\n\n• *Startup Leaders Pass*\n• *Corporate Leaders Pass*\n• *Investor Pass*\n\nIf you're serious about building with AI, this is the room."}
                    required
                    rows={7}
                    style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', padding: '8px 10px', width: '100%', outline: 'none', resize: 'vertical' }}
                  />
                  {tmplForm.bodyText && parseNamedVars(tmplForm.bodyText).length > 0 && (
                    <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {parseNamedVars(tmplForm.bodyText).map((v, i) => (
                        <span key={v} style={{ background: 'var(--amber-bg)', border: '0.5px solid var(--amber-border)', borderRadius: 3, padding: '1px 6px', fontSize: 9, color: 'var(--amber)', fontFamily: 'monospace' }}>
                          {`{{${v}}}`} → {`{{${i+1}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Footer (optional)</label>
                  <input value={tmplForm.footerText} onChange={e => setTmplForm(f => ({ ...f, footerText: e.target.value }))} placeholder="Reply STOP to unsubscribe" style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', padding: '7px 10px', width: '100%', outline: 'none' }} />
                </div>

                {/* Button */}
                <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 7, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>CTA Button (optional)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Button text</label>
                      <input value={tmplForm.buttonText} onChange={e => setTmplForm(f => ({ ...f, buttonText: e.target.value }))} placeholder="Book Your Pass Now" style={{ background: 'var(--surface)', border: '0.5px solid var(--border2)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit', padding: '6px 8px', width: '100%', outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Destination URL</label>
                      <input value={tmplForm.buttonUrl} onChange={e => { let v = e.target.value.trim(); if (v && !v.startsWith('https://')) v = 'https://' + v; setTmplForm(f => ({ ...f, buttonUrl: v })) }} placeholder="https://yourbrand.com/event" style={{ background: 'var(--surface)', border: '0.5px solid var(--border2)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit', padding: '6px 8px', width: '100%', outline: 'none' }} />
                      {tmplForm.buttonUrl && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>🔗 Clicks tracked via <span style={{ color: 'var(--amber)' }}>{baseUrl}/r/[slug]</span> — injected at send time</div>}
                      {tmplForm.buttonUrl && (
                        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>🔗 Tracking link auto-injected at send time via <span style={{ color: 'var(--amber)' }}>{baseUrl}/r/[campaign-slug]</span></div>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6 }}>Korant wraps this URL with a tracking link automatically. Every click is recorded in your dashboard.</div>
                </div>

                {tmplError && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 10 }}>{tmplError}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={() => setShowNewTemplate(false)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  <SubmitButton loading={tmplLoading} label="Submit for approval" />
                </div>
              </form>
            </div>

            {/* ── Right: WhatsApp bubble preview ── */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Preview</div>
              {/* Phone frame */}
              <div style={{ background: '#111b21', borderRadius: 16, padding: 12, minHeight: 300 }}>
                {/* Chat bubble */}
                {(tmplForm.bodyText || tmplForm.headerText) ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ maxWidth: '90%', background: '#202c33', borderRadius: '12px 0 12px 12px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                      {/* Header */}
                      {tmplForm.headerText && (
                        <div style={{ padding: '10px 12px 4px', fontSize: 13, fontWeight: 700, color: '#e9edef', lineHeight: 1.4 }}>
                          {tmplForm.headerText}
                        </div>
                      )}
                      {/* Body */}
                      <div style={{ padding: tmplForm.headerText ? '2px 12px 8px' : '10px 12px 8px', fontSize: 13, color: '#e9edef', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {tmplForm.bodyText
                          .replace(/\*([^*]+)\*/g, '$1')    // strip bold markers for preview
                          .replace(/_([^_]+)_/g, '$1')      // strip italic markers
                          .replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_: string, n: string) =>
                            n === 'name' ? 'Priya' : n === 'link' ? 'https://track.in/r/wa-...' : `[${n}]`
                          ) || ''}
                      </div>
                      {/* Footer */}
                      {tmplForm.footerText && (
                        <div style={{ padding: '0 12px 6px', fontSize: 11, color: '#8696a0' }}>{tmplForm.footerText}</div>
                      )}
                      {/* Timestamp */}
                      <div style={{ padding: '0 10px 6px', textAlign: 'right', fontSize: 11, color: '#8696a0' }}>
                        {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ✓✓
                      </div>
                      {/* CTA Button */}
                      {tmplForm.buttonText && (
                        <div style={{ borderTop: '0.5px solid #2a3942', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2 7h10M8 3l4 4-4 4" stroke="#53bdeb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize: 13, color: '#53bdeb', fontWeight: 500 }}>{tmplForm.buttonText}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', paddingTop: 40 }}>
                    <div style={{ fontSize: 12, color: '#8696a0' }}>Start typing to see preview</div>
                  </div>
                )}

                {/* Formatting guide */}
                <div style={{ marginTop: 16, background: '#1a2730', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, color: '#8696a0', marginBottom: 6 }}>WhatsApp formatting:</div>
                  {[
                    ['*text*',   'Bold'],
                    ['_text_',   'Italic'],
                    ['~text~',   'Strikethrough'],
                    ['```text```','Monospace'],
                    ['• text',   'Bullet (paste •)'],
                  ].map(([fmt, label]) => (
                    <div key={fmt} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <code style={{ fontSize: 10, color: '#53bdeb' }}>{fmt}</code>
                      <span style={{ fontSize: 10, color: '#8696a0' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── UPLOAD CONTACTS MODAL ── */}
      {showUploadContacts && (
        <Modal title="Upload contacts" onClose={() => setShowUploadContacts(false)}>
          <form onSubmit={uploadContacts}>
            <div style={{ background: 'var(--red-bg)', border: '0.5px solid var(--red-border)', borderRadius: 7, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 4 }}>Opt-in required</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>WhatsApp prohibits messaging people who have not explicitly opted in. Violations result in your number being banned by Meta.</div>
            </div>
            <FormField label="List name" required>
              <Input value={uploadForm.list_name} onChange={e => setUploadForm(f => ({ ...f, list_name: e.target.value }))} placeholder="Diwali customers, Newsletter subscribers…" required />
            </FormField>
            <FormField label="CSV file" required>
              <div style={{ border: '0.5px dashed var(--border2)', borderRadius: 7, padding: 20, textAlign: 'center', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ display: 'none' }} />
                {uploadData.length > 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--green)' }}>✓ {uploadData.length} contacts loaded</div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Click to select CSV</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Must have a "phone" column. Optional: "name" column. Country code auto-added for 10-digit numbers (India).</div>
                  </>
                )}
              </div>
            </FormField>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 7, padding: 12 }}>
              <input type="checkbox" id="optin" checked={uploadForm.opted_in_confirmed} onChange={e => setUploadForm(f => ({ ...f, opted_in_confirmed: e.target.checked }))} style={{ width: 'auto', marginTop: 2 }} />
              <label htmlFor="optin" style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>I confirm that all contacts in this list have explicitly opted in to receive WhatsApp messages from my brand. I understand that messaging non-opted-in contacts violates WhatsApp's policies and my account may be banned.</label>
            </div>
            {uploadError && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{uploadError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setShowUploadContacts(false)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <SubmitButton loading={uploadLoading} label={`Upload ${uploadData.length || ''} contacts`} />
            </div>
          </form>
        </Modal>
      )}

      {/* ── STATS MODAL ── */}
      {statsModal && (
        <Modal title={`${statsModal.name} — Stats`} onClose={() => { setStatsModal(null); setStatsData(null) }} width={560}>
          {!statsData ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
                {[
                  ['Sent',       statsData.stats.sent,            ''],
                  ['Delivered',  `${statsData.stats.delivered} (${statsData.stats.deliveryRate}%)`, 'var(--green)'],
                  ['Read',       `${statsData.stats.read} (${statsData.stats.readRate}%)`, 'var(--blue)'],
                  ['Clicked',    `${statsData.stats.clicked} (${statsData.stats.clickRate}%)`, 'var(--amber)'],
                  ['Sales',      statsData.stats.sales,            'var(--green)'],
                  ['Revenue',    `₹${statsData.stats.revenue?.toLocaleString('en-IN')}`, 'var(--amber)'],
                  ['Conv rate',  `${statsData.stats.conversionRate}%`, ''],
                  ['Failed',     statsData.stats.failed,           'var(--red)'],
                ].map(([l,v,c]) => (
                  <div key={l as string} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 7, padding: 12, textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 500, color: (c as string) || 'var(--text-primary)', marginBottom: 4 }}>{v}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{l}</div>
                  </div>
                ))}
              </div>
              {/* Message log */}
              {statsData.messages?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 10 }}>Message log (last 50)</div>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>{['Name', 'Phone', 'Status', 'Delivered', 'Read'].map(h => <th key={h} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-dim)', padding: '6px 8px', textAlign: 'left', borderBottom: '0.5px solid var(--border)', fontWeight: 400 }}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {statsData.messages.map((m: any) => (
                          <tr key={m.phone}>
                            <td style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '7px 8px', borderBottom: '0.5px solid var(--border3)' }}>{m.contact_name || '—'}</td>
                            <td style={{ fontSize: 11, color: 'var(--text-dim)', padding: '7px 8px', borderBottom: '0.5px solid var(--border3)', fontFamily: 'monospace' }}>+{m.phone}</td>
                            <td style={{ padding: '7px 8px', borderBottom: '0.5px solid var(--border3)' }}>
                              <span style={{ fontSize: 10, color: STATUS_COLOR[m.status] || 'var(--text-dim)' }}>● {m.status}</span>
                            </td>
                            <td style={{ fontSize: 10, color: 'var(--text-dim)', padding: '7px 8px', borderBottom: '0.5px solid var(--border3)' }}>{m.delivered_at ? new Date(m.delivered_at).toLocaleTimeString('en-IN') : '—'}</td>
                            <td style={{ fontSize: 10, color: 'var(--text-dim)', padding: '7px 8px', borderBottom: '0.5px solid var(--border3)' }}>{m.read_at ? new Date(m.read_at).toLocaleTimeString('en-IN') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
