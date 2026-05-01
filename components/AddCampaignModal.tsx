'use client'
import { useState } from 'react'
import Modal from './Modal'
import { FormField, Input, Textarea, SubmitButton } from './FormFields'

interface Props { clientId: string; onClose: () => void; onCreated: (c: any) => void }

export default function AddCampaignModal({ clientId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, clientId }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error); return }
    onCreated(data)
    onClose()
  }

  return (
    <Modal title="New campaign" onClose={onClose}>
      <form onSubmit={submit}>
        <FormField label="Campaign name" required>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Summer Sale 2025" required />
        </FormField>
        <FormField label="Description">
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes about this campaign" />
        </FormField>
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid #2a2a2a', color: '#5a5652', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <SubmitButton loading={loading} label="Create campaign" />
        </div>
      </form>
    </Modal>
  )
}
