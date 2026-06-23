// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  components/AddAffiliateModal.tsx                           │
// │ Replace the existing file at <repo-root>/components/AddAffiliateModal.tsx │
// └──────────────────────────────────────────────────────────────────────┘
'use client'
import { useCouponIntegrations, CouponStatusHint } from './CouponStatusHint'
import { useState } from 'react'
import Modal from './Modal'
import { FormField, Input, Select, SubmitButton, UrlInput } from './FormFields'

interface Props { clientId: string; programs: { id: string; name: string; commission_type: string; commission_value: number }[]; campaigns: { id: string; name: string }[]; onClose: () => void; onCreated: (a: any) => void }

export default function AddAffiliateModal({ clientId, programs, campaigns, onClose, onCreated }: Props) {
  const couponIntegrations = useCouponIntegrations()
  const [form, setForm] = useState({ name: '', handle: '', email: '', phone: '', destination_url: '', discount_code: '', commission_type: 'percentage', commission_value: '10', commission_trigger: 'per_sale', attribution_window_days: '30', program_id: '', campaign_id: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/affiliates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, clientId, commission_value: parseFloat(form.commission_value), attribution_window_days: parseInt(form.attribution_window_days) }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    onCreated(data)
    onClose()
  }

  return (
    <Modal title="Add affiliate" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Name" required><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Neha Sharma" required /></FormField>
          <FormField label="Handle" required><Input value={form.handle} onChange={e => set('handle', e.target.value)} placeholder="@neha" required /></FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Email"><Input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></FormField>
          <FormField label="Phone"><Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></FormField>
        </div>
        <FormField label="Destination URL" required><UrlInput value={form.destination_url} onChange={v => set('destination_url', v)} placeholder="yourbrand.com" required /></FormField>
        <FormField label="Discount code"><Input value={form.discount_code} onChange={e => set('discount_code', e.target.value.toUpperCase())} />
          <CouponStatusHint code={form.discount_code} status={couponIntegrations} /></FormField>
        {programs.length > 0 ? (
          <FormField label="Program"><Select value={form.program_id} onChange={e => set('program_id', e.target.value)} options={[{ value: '', label: 'Custom commission' }, ...programs.map(p => ({ value: p.id, label: `${p.name} (${p.commission_value}${p.commission_type === 'percentage' ? '%' : '₹'})` }))]} /></FormField>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Commission type"><Select value={form.commission_type} onChange={e => set('commission_type', e.target.value)} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'flat', label: 'Flat (₹)' }]} /></FormField>
            <FormField label={form.commission_type === 'percentage' ? 'Commission %' : 'Commission ₹'}><Input type="number" value={form.commission_value} onChange={e => set('commission_value', e.target.value)} /></FormField>
          </div>
        )}
        {/* Attribution window is editable for custom commission (with a program, the
            program's window is used). Commission trigger is per_sale — the only
            trigger the attribution engine currently pays on. */}
        {!form.program_id && (
          <FormField label="Attribution window (days)">
            <Input type="number" value={form.attribution_window_days} onChange={e => set('attribution_window_days', e.target.value)} />
          </FormField>
        )}
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <SubmitButton loading={loading} label="Add affiliate" />
        </div>
      </form>
    </Modal>
  )
}
