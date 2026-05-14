'use client'
import { useState } from 'react'

interface OnboardingState {
  domain_done?:    boolean; domain_skipped?:    boolean; tracking_domain?: string
  tracking_done?:  boolean; tracking_skipped?:  boolean; store_url?: string
  webhook_done?:   boolean; webhook_skipped?:   boolean
}

interface Props {
  user: { id: string; onboarding?: OnboardingState }
  onClose: () => void
  onSave:  (ob: OnboardingState) => void
}

// ── Styling helpers ───────────────────────────────────────────────────────────
const card = (done: boolean, skipped: boolean): React.CSSProperties => ({
  background:   'var(--surface)',
  border:       `0.5px solid ${done ? '#4a7c3f' : skipped ? 'var(--border2)' : 'var(--border)'}`,
  borderRadius: 10,
  padding:      '18px 20px',
  marginBottom: 12,
  opacity:      skipped && !done ? 0.6 : 1,
})
const pill = (active: boolean, color = 'var(--amber)'): React.CSSProperties => ({
  padding:      '5px 14px',
  borderRadius: 6,
  border:       `0.5px solid ${active ? color : 'var(--border2)'}`,
  background:   active ? `${color}15` : 'transparent',
  color:        active ? color : 'var(--text-muted)',
  fontSize:     12,
  cursor:       'pointer',
  fontFamily:   'var(--font-sans)',
})
const inputStyle: React.CSSProperties = {
  width:        '100%',
  background:   'var(--surface2)',
  border:       '0.5px solid var(--border2)',
  borderRadius: 6,
  padding:      '8px 12px',
  fontSize:     13,
  color:        'var(--text-primary)',
  fontFamily:   'var(--font-sans)',
  outline:      'none',
  marginTop:    8,
}

export default function SetupModal({ user, onClose, onSave }: Props) {
  const ob0 = user.onboarding || {}
  const [ob, setOb]           = useState<OnboardingState>(ob0)
  const [checking, setChecking] = useState<string | null>(null)
  const [checkMsg, setCheckMsg] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [saving, setSaving]   = useState(false)

  const save = async (updated: OnboardingState) => {
    setSaving(true)
    try {
      const res = await fetch('/api/auth/onboarding', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(updated),
      })
      const data = await res.json()
      const saved = data.onboarding || updated
      setOb(saved)
      onSave(saved)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const markDone = (field: keyof OnboardingState) => {
    const updated = { ...ob, [field]: true }
    setOb(updated)
    save(updated)
  }

  const markSkipped = (field: keyof OnboardingState) => {
    // Skip just records "skipped" but does NOT mark as done.
    // The dashboard counter only counts _done fields, not _skipped.
    const updated = { ...ob, [field]: true }
    setOb(updated)
    save(updated)
  }

  const verify = async (type: string) => {
    setChecking(type)
    setCheckMsg(prev => ({ ...prev, [type]: { ok: false, message: 'Checking…' } }))
    try {
      const res  = await fetch('/api/setup/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type,
          trackingDomain: ob.tracking_domain,
          storeUrl:       ob.store_url,
        }),
      })
      const data = await res.json()
      setCheckMsg(prev => ({ ...prev, [type]: { ok: data.ok, message: data.message } }))
      if (data.ok) {
        // Auto-mark as done when verification passes
        const doneField = type === 'domain'   ? 'domain_done'
                        : type === 'tracking' ? 'tracking_done'
                        : type === 'webhook'  ? 'webhook_done'
                        : null
        if (doneField) {
          const updated = { ...ob, [doneField]: true }
          setOb(updated)
          save(updated)
        }
      }
    } catch {
      setCheckMsg(prev => ({ ...prev, [type]: { ok: false, message: 'Check failed — try again' } }))
    }
    setChecking(null)
  }

  const statusIcon = (done?: boolean, skipped?: boolean) =>
    done ? '✓' : skipped ? '—' : '○'

  const statusColor = (done?: boolean, skipped?: boolean) =>
    done ? '#4a7c3f' : skipped ? 'var(--text-dim)' : 'var(--text-muted)'

  // Count only _done fields (skipped does NOT count)
  const doneCount = [ob.domain_done, ob.tracking_done, ob.webhook_done].filter(Boolean).length

  // ── Tracking snippet ──────────────────────────────────────────────────────
  const snippet = `<!-- MicroKorant Tracking — paste before </body> -->
<script>
(function(){
  var d=document,s='kv_partner',u='kv_id';
  function gc(n){var m=d.cookie.match('(^|;)\\\\s*'+n+'=([^;]+)');return m?m[2]:null}
  function sc(n,v,days){var e=new Date();e.setTime(e.getTime()+days*864e5);d.cookie=n+'='+v+';path=/;expires='+e.toUTCString()}
  var p=new URLSearchParams(location.search).get('kv')||new URLSearchParams(location.search).get('partner');
  if(p){sc(s,p,90)}
  if(!gc(u)){sc(u,Math.random().toString(36).slice(2),365)}
  fetch('/api/beacon',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({visitor_id:gc(u),partner_slug:gc(s)||p,page:location.pathname,
      referrer:document.referrer,ua:navigator.userAgent})}).catch(function(){});
})();
</script>`

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 620, maxHeight: '90vh', overflow: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>Setup — {doneCount}/3 complete</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
              {doneCount === 3 ? 'All set! Your tracking is live.' : 'Complete setup to enable full attribution tracking.'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>

          {/* ── Step 1: Custom tracking domain ── */}
          <div style={card(!!ob.domain_done, !!ob.domain_skipped)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18, color: statusColor(ob.domain_done, ob.domain_skipped), fontWeight: 600 }}>{statusIcon(ob.domain_done, ob.domain_skipped)}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Custom tracking domain</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>CNAME: tracking.yourdomain.com → tracking.microkorant.in</div>
              </div>
            </div>

            {!ob.domain_done && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                  Add a CNAME record in your DNS settings. Without this, tracking links use our domain instead of yours.
                </div>
                <input
                  style={inputStyle}
                  placeholder="tracking.yourbrand.com"
                  value={ob.tracking_domain || ''}
                  onChange={e => setOb(prev => ({ ...prev, tracking_domain: e.target.value }))}
                />
                {checkMsg.domain && (
                  <div style={{ marginTop: 8, fontSize: 12, color: checkMsg.domain.ok ? '#4a7c3f' : 'var(--red)', padding: '6px 10px', background: checkMsg.domain.ok ? '#4a7c3f18' : 'var(--red-bg)', borderRadius: 6 }}>
                    {checkMsg.domain.message}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => verify('domain')}
                    disabled={!ob.tracking_domain || checking === 'domain'}
                    style={{ ...pill(!!ob.tracking_domain, 'var(--amber)'), opacity: (!ob.tracking_domain || checking === 'domain') ? 0.5 : 1 }}
                  >
                    {checking === 'domain' ? 'Checking…' : 'Check DNS'}
                  </button>
                  <button onClick={() => markDone('domain_done')} style={pill(false)}>Mark done</button>
                  {!ob.domain_skipped && (
                    <button onClick={() => markSkipped('domain_skipped')} style={{ ...pill(false), marginLeft: 'auto', color: 'var(--text-dim)' }}>Skip for now</button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Step 2: Store tracking script (beacon + attribution unified) ── */}
          <div style={card(!!ob.tracking_done, !!ob.tracking_skipped)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18, color: statusColor(ob.tracking_done, ob.tracking_skipped), fontWeight: 600 }}>{statusIcon(ob.tracking_done, ob.tracking_skipped)}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Store tracking script</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Handles visitor tracking + sale attribution in one snippet</div>
              </div>
            </div>

            {!ob.tracking_done && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                  Paste this into your store theme before <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>&lt;/body&gt;</code>. It handles both analytics (Unique/Returned/Shared visitors) and sale attribution (who gets credit when a customer buys). Works alongside Google Analytics — no conflicts.
                </div>

                {/* Snippet */}
                <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, position: 'relative' }}>
                  <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>{snippet}</pre>
                  <button
                    onClick={() => navigator.clipboard.writeText(snippet)}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'var(--surface)', border: '0.5px solid var(--border2)', color: 'var(--text-dim)', borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}
                  >Copy</button>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  ℹ️ This replaces both the "Analytics Beacon" and "Cookie Attribution" steps — one snippet handles both.
                </div>

                <input
                  style={inputStyle}
                  placeholder="https://yourstore.com"
                  value={ob.store_url || ''}
                  onChange={e => setOb(prev => ({ ...prev, store_url: e.target.value }))}
                />
                {checkMsg.tracking && (
                  <div style={{ marginTop: 8, fontSize: 12, color: checkMsg.tracking.ok ? '#4a7c3f' : 'var(--red)', padding: '6px 10px', background: checkMsg.tracking.ok ? '#4a7c3f18' : 'var(--red-bg)', borderRadius: 6 }}>
                    {checkMsg.tracking.message}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => verify('tracking')}
                    disabled={!ob.store_url || checking === 'tracking'}
                    style={{ ...pill(!!ob.store_url, 'var(--amber)'), opacity: (!ob.store_url || checking === 'tracking') ? 0.5 : 1 }}
                  >
                    {checking === 'tracking' ? 'Checking…' : 'Verify script'}
                  </button>
                  <button onClick={() => markDone('tracking_done')} style={pill(false)}>Mark done</button>
                  {!ob.tracking_skipped && (
                    <button onClick={() => markSkipped('tracking_skipped')} style={{ ...pill(false), marginLeft: 'auto', color: 'var(--text-dim)' }}>Skip for now</button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Step 3: Store webhook ── */}
          <div style={card(!!ob.webhook_done, !!ob.webhook_skipped)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18, color: statusColor(ob.webhook_done, ob.webhook_skipped), fontWeight: 600 }}>{statusIcon(ob.webhook_done, ob.webhook_skipped)}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Store webhook</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sends order data to MicroKorant for sale attribution</div>
              </div>
            </div>

            {!ob.webhook_done && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
                  In your Shopify/WooCommerce admin, add an order webhook pointing to:
                </div>
                <div style={{ background: 'var(--surface2)', border: '0.5px solid var(--border2)', borderRadius: 6, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--amber)', marginBottom: 10, userSelect: 'all' }}>
                  https://www.microkorant.in/api/webhook/orders
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Topic: <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>orders/paid</code>. The "Verify" button checks if any events have arrived from your store in the last 7 days.
                </div>
                {checkMsg.webhook && (
                  <div style={{ marginTop: 8, marginBottom: 10, fontSize: 12, color: checkMsg.webhook.ok ? '#4a7c3f' : 'var(--red)', padding: '6px 10px', background: checkMsg.webhook.ok ? '#4a7c3f18' : 'var(--red-bg)', borderRadius: 6 }}>
                    {checkMsg.webhook.message}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => verify('webhook')}
                    disabled={checking === 'webhook'}
                    style={{ ...pill(true, 'var(--amber)'), opacity: checking === 'webhook' ? 0.5 : 1 }}
                  >
                    {checking === 'webhook' ? 'Checking…' : 'Verify webhook'}
                  </button>
                  <button onClick={() => markDone('webhook_done')} style={pill(false)}>Mark done</button>
                  {!ob.webhook_skipped && (
                    <button onClick={() => markSkipped('webhook_skipped')} style={{ ...pill(false), marginLeft: 'auto', color: 'var(--text-dim)' }}>Skip for now</button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── WhatsApp check ── */}
          <div style={{ marginTop: 24, borderTop: '0.5px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 12 }}>Additional checks</div>

            {/* WhatsApp */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '0.5px solid var(--border3)' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>WhatsApp connection</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Phone number & webhook</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {checkMsg.whatsapp && (
                  <span style={{ fontSize: 11, color: checkMsg.whatsapp.ok ? '#4a7c3f' : 'var(--text-dim)', maxWidth: 220, textAlign: 'right' }}>{checkMsg.whatsapp.message}</span>
                )}
                <button onClick={() => verify('whatsapp')} disabled={checking === 'whatsapp'} style={{ ...pill(false), opacity: checking === 'whatsapp' ? 0.5 : 1 }}>
                  {checking === 'whatsapp' ? '…' : 'Check'}
                </button>
              </div>
            </div>

            {/* Analytics/GSC */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Google Search Console</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Keyword & ranking data</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {checkMsg.analytics && (
                  <span style={{ fontSize: 11, color: checkMsg.analytics.ok ? '#4a7c3f' : 'var(--text-dim)', maxWidth: 220, textAlign: 'right' }}>{checkMsg.analytics.message}</span>
                )}
                <button onClick={() => verify('analytics')} disabled={checking === 'analytics'} style={{ ...pill(false), opacity: checking === 'analytics' ? 0.5 : 1 }}>
                  {checking === 'analytics' ? '…' : 'Check'}
                </button>
              </div>
            </div>
          </div>

        </div>

        <div style={{ padding: '16px 24px', borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'var(--amber)', border: 'none', color: '#0d0d0d', fontWeight: 500, borderRadius: 7, padding: '8px 20px', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}