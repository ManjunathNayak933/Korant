'use client'
import { useState } from 'react'
import Modal from './Modal'

const STEPS = [
  {
    key: 'domain',
    doneKey: 'domain_done',
    skipKey: 'domain_skipped',
    title: 'Custom domain',
    icon: '🌐',
    desc: 'Set up a custom tracking domain (e.g. track.yourbrand.com)',
  },
  {
    key: 'webhook',
    doneKey: 'webhook_done',
    skipKey: 'webhook_skipped',
    title: 'Webhook',
    icon: '🔗',
    desc: 'Connect your store to attribute sales automatically',
  },
  {
    key: 'attribution',
    doneKey: 'attribution_done',
    skipKey: 'attribution_skipped',
    title: 'Cookie attribution',
    icon: '🍪',
    desc: 'Add the checkout snippet so orders carry attribution data',
  },
]

interface Props {
  user: any
  onClose: () => void
  onSave: (ob: Record<string, boolean>) => void
}

export default function SetupModal({ user, onClose, onSave }: Props) {
  const [onboarding, setOnboarding] = useState<Record<string, boolean>>(user?.onboarding || {})
  const [domain, setDomain] = useState(user?.custom_domain || '')
  const [saving, setSaving] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const BASE = typeof window !== 'undefined' ? window.location.origin : 'https://app.korant.in'
  const clientId = user?.id || ''

  const mark = async (doneKey: string, skipKey?: string, extra?: Record<string, any>) => {
    setSaving(doneKey)
    const updates = { ...onboarding, [doneKey]: true }
    if (skipKey) updates[skipKey] = false
    const body: any = { onboarding: updates }
    if (extra) Object.assign(body, extra)
    await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setOnboarding(updates)
    onSave(updates)
    setSaving(null)
    setActiveStep(null)
  }

  const skip = async (skipKey: string) => {
    setSaving(skipKey)
    const updates = { ...onboarding, [skipKey]: true }
    await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarding: updates }),
    })
    setOnboarding(updates)
    onSave(updates)
    setSaving(null)
    setActiveStep(null)
  }

  const isDone = (step: typeof STEPS[0]) =>
    onboarding[step.doneKey] || onboarding[step.skipKey]

  const completedCount = STEPS.filter(s => isDone(s)).length

  return (
    <Modal title="Setup" onClose={onClose} width={520}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{completedCount} of {STEPS.length} completed</span>
          {completedCount === STEPS.length && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ All done</span>}
          <button onClick={async () => {
            const empty = {}
            await fetch('/api/clients/goals', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarding: empty }) })
            setOnboarding(empty)
            onSave(empty)
          }} style={{ fontSize: 10, color: 'var(--text-muted)', background: 'transparent', border: '0.5px solid var(--border2)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', marginLeft: 8 }}>Reset</button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {STEPS.map(s => (
            <div key={s.key} style={{ flex: 1, height: 3, borderRadius: 2, background: isDone(s) ? 'var(--green)' : 'var(--border2)' }} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STEPS.map(step => {
          const done = isDone(step)
          const expanded = activeStep === step.key

          return (
            <div key={step.key} style={{ background: 'var(--surface2)', border: `0.5px solid ${done ? 'var(--green-border)' : expanded ? 'var(--amber-border)' : 'var(--border)'}`, borderRadius: 9 }}>
              {/* Header row */}
              <div
                onClick={() => !done && setActiveStep(expanded ? null : step.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: done ? 'default' : 'pointer' }}
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: done ? 'var(--green-bg)' : 'var(--surface)', border: `0.5px solid ${done ? 'var(--green-border)' : 'var(--border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
                  {done ? '✓' : step.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: done ? 'var(--text-muted)' : 'var(--text-primary)' }}>{step.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{step.desc}</div>
                </div>
                {done
                  ? <span style={{ fontSize: 11, color: 'var(--green)', flexShrink: 0 }}>Done</span>
                  : <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
                }
              </div>

              {/* Expanded content */}
              {expanded && !done && (
                <div style={{ padding: '0 16px 16px' }}>
                  {step.key === 'domain' && (
                    <>
                      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 7, padding: 12, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.9 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-dim)', marginBottom: 6 }}>DNS record to add</div>
                        <div><span style={{ color: 'var(--text-dim)' }}>Type:</span> CNAME</div>
                        <div><span style={{ color: 'var(--text-dim)' }}>Name:</span> track</div>
                        <div><span style={{ color: 'var(--text-dim)' }}>Value:</span> <code style={{ color: 'var(--amber)' }}>cname.korant.app</code></div>
                      </div>
                      <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="track.yourbrand.com" style={{ marginBottom: 10 }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => mark(step.doneKey, undefined, { custom_domain: domain })} disabled={saving === step.doneKey} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Mark done'}</button>
                        <button onClick={() => skip(step.skipKey!)} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>Skip</button>
                      </div>
                    </>
                  )}
                  {step.key === 'webhook' && (
                    <>
                      {[
                        { label: 'Shopify', url: `${BASE}/api/webhook/shopify`, note: 'Settings → Notifications → Webhooks → Order payment' },
                        { label: 'Razorpay', url: `${BASE}/api/webhook/razorpay?clientId=${clientId}`, note: 'Dashboard → Account Settings → Webhooks' },
                        { label: 'Generic', url: `${BASE}/api/webhook/generic?clientId=${clientId}`, note: 'POST: orderId, orderValue, discountCode, mkSlug' },
                      ].map(w => (
                        <div key={w.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 7, padding: 10, marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>{w.label}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <code style={{ fontSize: 11, color: 'var(--amber)', flex: 1, wordBreak: 'break-all' }}>{w.url}</code>
                            <button onClick={() => navigator.clipboard.writeText(w.url)} style={{ background: 'transparent', border: '0.5px solid var(--border2)', color: 'var(--text-dim)', borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>Copy</button>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{w.note}</div>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => mark(step.doneKey)} disabled={saving === step.doneKey} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Mark done'}</button>
                        <button onClick={() => skip(step.skipKey!)} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>Skip</button>
                      </div>
                    </>
                  )}
                  {step.key === 'attribution' && (
                    <>
                      <pre style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 7, padding: 12, fontSize: 10, color: 'var(--text-muted)', overflowX: 'auto', lineHeight: 1.7, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{`<script>
(function(){
  function gc(n){
    return document.cookie.split('; ')
      .find(r=>r.startsWith(n+'='))?.split('=')[1]||'';
  }
  var s=gc('mk_slug'), f=gc('mk_slug_first');
  if(s){ fetch('/cart/update.js',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({attributes:{mk_slug:s,mk_slug_first:f}})
  }); }
})();
</script>`}</pre>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Paste into Shopify → Settings → Checkout → Order status page → Additional scripts</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => mark(step.doneKey)} disabled={saving === step.doneKey} style={{ border: '0.5px solid var(--amber)', color: 'var(--amber)', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Mark done'}</button>
                        <button onClick={() => skip(step.skipKey!)} style={{ border: '0.5px solid var(--border2)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>Skip</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}