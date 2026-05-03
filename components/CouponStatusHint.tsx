'use client'
import { useState, useEffect } from 'react'

interface IntegrationStatus { shopify: boolean; razorpay: boolean }

export function useCouponIntegrations() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  useEffect(() => {
    fetch('/api/clients/integrations').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])
  return status
}

export function CouponStatusHint({ code, status }: { code: string; status: IntegrationStatus | null }) {
  if (!code || !status) return null
  const lines = []
  if (status.shopify) lines.push({ icon: '🟢', text: 'Will auto-create on Shopify' })
  else lines.push({ icon: '⚠️', text: 'Shopify not connected — code saved to Korant only' })
  if (status.razorpay) lines.push({ icon: '🟢', text: 'Will auto-create on Razorpay' })
  else lines.push({ icon: '⚠️', text: 'Razorpay not connected — code saved to Korant only' })

  return (
    <div style={{ marginTop: 4 }}>
      {lines.map(l => (
        <div key={l.text} style={{ fontSize: 10, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span>{l.icon}</span><span>{l.text}</span>
        </div>
      ))}
    </div>
  )
}