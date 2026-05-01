'use client'
import { useState } from 'react'
import Modal from './Modal'
import { FormField, Input, Select, SubmitButton, UrlInput } from './FormFields'

interface Props { clientId: string; campaigns: { id: string; name: string }[]; onClose: () => void; onCreated: (p: any) => void }

export default function AddPublicationModal({ clientId, campaigns, onClose, onCreated }: Props) {
  const [form, setForm] = useState({ publication_name: '', author_name: '', type: 'article', article_url: '', destination_url: '', estimated_reach: '', cost: '', is_sponsored: false, published_at: '', campaign_id: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, clientId, estimated_reach: parseInt(form.estimated_reach) || null, cost: parseFloat(form.cost) || 0 }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    onCreated(data)
    onClose()
  }

  return (
    <Modal title="Add publication" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Publication name" required>
            <Input value={form.publication_name} onChange={e => set('publication_name', e.target.value)} placeholder="TechCrunch India" required />
          </FormField>
          <FormField label="Author name">
            <Input value={form.author_name} onChange={e => set('author_name', e.target.value)} placeholder="Rahul Verma" />
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Type">
            <Select value={form.type} onChange={e => set('type', e.target.value)} options={[
              { value: 'article', label: 'Article' }, { value: 'review', label: 'Review' },
              { value: 'mention', label: 'Mention' }, { value: 'guest_post', label: 'Guest post' },
            ]} />
          </FormField>
          <FormField label="Published date">
            <Input type="date" value={form.published_at} onChange={e => set('published_at', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Article URL">
          <UrlInput value={form.article_url} onChange={v => set('article_url', v)} placeholder="techcrunch.com/your-article" />
        </FormField>
        <FormField label="Destination URL" required>
          <UrlInput value={form.destination_url} onChange={v => set('destination_url', v)} placeholder="yourbrand.com" required />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Cost (₹)">
            <Input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="0" />
          </FormField>
          <FormField label="Est. reach">
            <Input type="number" value={form.estimated_reach} onChange={e => set('estimated_reach', e.target.value)} placeholder="50000" />
          </FormField>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <input type="checkbox" id="sponsored" checked={form.is_sponsored} onChange={e => set('is_sponsored', e.target.checked)} />
          <label htmlFor="sponsored" style={{ fontSize: 12, color: '#7a7670', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>Sponsored content</label>
        </div>
        {campaigns.length > 0 && (
          <FormField label="Campaign">
            <Select value={form.campaign_id} onChange={e => set('campaign_id', e.target.value)} options={[{ value: '', label: 'No campaign' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]} />
          </FormField>
        )}
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <SubmitButton loading={loading} label="Add publication" />
        </div>
      </form>
    </Modal>
  )
}
