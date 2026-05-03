'use client'
import { useCouponIntegrations, CouponStatusHint } from './CouponStatusHint'
import { useState } from 'react'
import Modal from './Modal'
import { FormField, Input, Select, SubmitButton, UrlInput } from './FormFields'

interface Props {
  clientId: string
  campaigns: { id: string; name: string }[]
  onClose: () => void
  onCreated: (inf: any) => void
}

export default function AddInfluencerModal({ clientId, campaigns, onClose, onCreated }: Props) {
  const couponIntegrations = useCouponIntegrations()
  const [form, setForm] = useState({ name: '', handle: '', social_platform: 'instagram', social_url: '', destination_url: '', discount_code: '', fee: '', campaign_id: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, clientId, fee: parseFloat(form.fee) || 0 }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed'); setLoading(false); return }
      onCreated(data)
      onClose()
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <Modal title="Add influencer" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Name" required>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Priya Kapoor" required />
          </FormField>
          <FormField label="Handle" required>
            <Input value={form.handle} onChange={e => set('handle', e.target.value)} placeholder="@priyaglow" required />
          </FormField>
        </div>
        <FormField label="Platform">
          <Select value={form.social_platform} onChange={e => set('social_platform', e.target.value)} options={[
            { value: 'instagram', label: 'Instagram' },
            { value: 'youtube', label: 'YouTube' },
            { value: 'twitter', label: 'Twitter/X' },
            { value: 'tiktok', label: 'TikTok' },
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
        {campaigns.length > 0 && (
          <FormField label="Campaign">
            <Select value={form.campaign_id} onChange={e => set('campaign_id', e.target.value)} options={[{ value: '', label: 'No campaign' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]} />
          </FormField>
        )}
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <SubmitButton loading={loading} label="Add influencer" />
        </div>
      </form>
    </Modal>
  )
}