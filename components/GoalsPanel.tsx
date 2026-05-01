'use client'
import { useState } from 'react'
import Modal from './Modal'
import { FormField, Input, SubmitButton } from './FormFields'

interface Goal { clicks?: number; sales?: number; revenue?: number; budget?: number }
interface Props { goals: Goal; actual: { clicks: number; sales: number; revenue: number; budget: number }; clientId: string; month: string; onUpdated: (g: Goal) => void }

const BAR_COLOR = { clicks: '#4a9eff', sales: '#2ecc71', revenue: '#d4a843', budget: '#e74c3c' }

export default function GoalsPanel({ goals, actual, clientId, month, onUpdated }: Props) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Goal>(goals)
  const [loading, setLoading] = useState(false)

  const items: { key: keyof Goal; label: string; fmt: (v: number) => string }[] = [
    { key: 'clicks', label: 'Clicks', fmt: v => v.toLocaleString('en-IN') },
    { key: 'sales', label: 'Sales', fmt: v => v.toLocaleString('en-IN') },
    { key: 'revenue', label: 'Revenue', fmt: v => `₹${(v / 100000).toFixed(1)}L` },
    { key: 'budget', label: 'Budget', fmt: v => `₹${(v / 100000).toFixed(1)}L` },
  ]

  const save = async () => {
    setLoading(true)
    await fetch(`/api/clients/${clientId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals: { ...(goals as any), [month]: form } }) })
    setLoading(false)
    onUpdated(form)
    setEditing(false)
  }

  return (
    <>
      <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 10, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642' }}>Monthly goals</span>
            <span style={{ fontSize: 10, color: '#3a3632', marginLeft: 8 }}>{month}</span>
          </div>
          <button onClick={() => setEditing(true)} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Edit targets</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {items.map(({ key, label, fmt }) => {
            const target = goals[key] || 0
            const value = actual[key] || 0
            const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0
            return (
              <div key={key} style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 6, padding: 11 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4a4642', marginBottom: 5 }}>{label}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
                  <span style={{ fontSize: 17, fontWeight: 500, color: '#e8e4dc' }}>{fmt(value)}</span>
                  <span style={{ fontSize: 10, color: '#2a2622' }}>/ {target > 0 ? fmt(target) : '—'}</span>
                </div>
                <div style={{ height: 2, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: BAR_COLOR[key], borderRadius: 2 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editing && (
        <Modal title="Set monthly targets" onClose={() => setEditing(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {items.map(({ key, label }) => (
              <FormField key={key} label={label}>
                <Input type="number" value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: parseInt(e.target.value) || 0 }))} placeholder="0" />
              </FormField>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <SubmitButton loading={loading} label="Save targets" loadingLabel="Saving…" />
          </div>
        </Modal>
      )}
    </>
  )
}
