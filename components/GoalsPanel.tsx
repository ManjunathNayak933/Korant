'use client'
import { useState, useEffect } from 'react'
import Modal from './Modal'
import { FormField, Input, SubmitButton } from './FormFields'

interface Goals {
  influencers?: number
  seo_publications?: number
  affiliates?: number
  campaigns?: number
  whatsapp_messages?: number
}

interface Actuals {
  influencers: number
  seo_publications: number
  affiliates: number
  campaigns: number
  whatsapp_messages: number
}

interface Props {
  clientId: string
  month: string
  goals: Goals
  onUpdated: (g: Goals) => void
}

const ITEMS: { key: keyof Goals; label: string; color: string; icon: string; hint: string }[] = [
  { key: 'influencers',      label: 'Influencers added',     color: 'var(--amber)', icon: '🎯', hint: 'New influencers onboarded this month' },
  { key: 'seo_publications', label: 'SEO publications',      color: 'var(--blue)',  icon: '📄', hint: 'Articles / placements published' },
  { key: 'affiliates',       label: 'Affiliates signed up',  color: 'var(--green)', icon: '🔗', hint: 'New affiliates or ambassadors' },
  { key: 'campaigns',        label: 'Campaigns run',         color: '#9b59b6',      icon: '📢', hint: 'Active campaigns this month' },
  { key: 'whatsapp_messages',label: 'WhatsApp messages sent',color: '#25d366',      icon: '💬', hint: 'Total messages across all WA campaigns' },
]

export default function GoalsPanel({ clientId, month, goals, onUpdated }: Props) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Goals>(goals)
  const [loading, setLoading] = useState(false)
  const [actuals, setActuals] = useState<Actuals>({ influencers: 0, seo_publications: 0, affiliates: 0, campaigns: 0, whatsapp_messages: 0 })

  // Load actual counts from the API
  useEffect(() => {
    const load = async () => {
      const [infRes, pubRes, affRes, campRes, waRes] = await Promise.all([
        fetch(`/api/influencers?clientId=${clientId}`),
        fetch(`/api/publications?clientId=${clientId}`),
        fetch(`/api/affiliates?clientId=${clientId}`),
        fetch(`/api/campaigns?clientId=${clientId}`),
        fetch(`/api/whatsapp/campaigns`),
      ])
      const [infs, pubs, affs, camps, waCamps] = await Promise.all([
        infRes.json(), pubRes.json(), affRes.json(), campRes.json(), waRes.json(),
      ])

      // Count items created THIS month
      const isThisMonth = (dateStr: string) =>
        dateStr?.startsWith(month)

      const waMessagesSent = Array.isArray(waCamps)
        ? waCamps.filter((c: any) => c.status === 'sent' && isThisMonth(c.sent_at || '')).reduce((s: number, c: any) => s + (c.sent || 0), 0)
        : 0

      setActuals({
        influencers:       Array.isArray(infs)  ? infs.filter((i: any)  => isThisMonth(i.created_at)).length  : 0,
        seo_publications:  Array.isArray(pubs)  ? pubs.filter((p: any)  => isThisMonth(p.created_at)).length  : 0,
        affiliates:        Array.isArray(affs)  ? affs.filter((a: any)  => isThisMonth(a.created_at)).length  : 0,
        campaigns:         Array.isArray(camps) ? camps.filter((c: any) => isThisMonth(c.created_at)).length  : 0,
        whatsapp_messages: waMessagesSent,
      })
    }
    load()
  }, [clientId, month])

  // Sync form when goals prop changes
  useEffect(() => { setForm(goals) }, [goals])

  const save = async () => {
    setLoading(true)
    const res = await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: { ...(goals as any), [month]: form } }),
    })
    setLoading(false)
    if (res.ok) {
      onUpdated(form)
      setEditing(false)
    }
  }

  return (
    <>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>Monthly targets</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 8 }}>{month}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Edit targets
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ITEMS.map(({ key, label, color, icon }) => {
            const target = goals[key] || 0
            const value  = actuals[key] || 0
            const pct    = target > 0 ? Math.min((value / target) * 100, 100) : 0
            const done   = target > 0 && value >= target

            return (
              <div key={key} style={{ background: 'var(--surface2)', border: '0.5px solid var(--border3)', borderRadius: 7, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 13 }}>{icon}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                    {done && <span style={{ fontSize: 9, color, background: 'var(--surface)', border: `0.5px solid ${color}`, borderRadius: 3, padding: '1px 6px' }}>✓ Done</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 500, color }}>{value}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>/ {target > 0 ? target : '—'}</span>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ height: 2, background: 'var(--border3)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: color,
                    borderRadius: 2,
                    transition: 'width 0.4s',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editing && (
        <Modal title={`Set targets — ${month}`} onClose={() => setEditing(false)}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Set how many of each you want to add or send this month. Leave at 0 to hide the progress bar.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ITEMS.map(({ key, label, icon, hint }) => (
              <FormField key={key} label={`${icon} ${label}`} hint={hint}>
                <Input
                  type="number"
                  min="0"
                  value={form[key] || ''}
                  onChange={e => setForm(f => ({ ...f, [key]: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
              </FormField>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button
              onClick={() => setEditing(false)}
              style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-muted)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={loading}
              style={{ background: 'transparent', border: '0.5px solid var(--amber)', color: 'var(--amber)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Saving…' : 'Save targets'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}