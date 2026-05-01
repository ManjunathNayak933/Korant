export const runtime = 'edge'
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const STEPS = [
  { id: 'domain', title: 'Custom domain', desc: 'Set your brand\'s tracking domain', doneKey: 'domain_done', skipKey: 'domain_skipped' },
  { id: 'webhook', title: 'Webhook setup', desc: 'Connect your store to attribute sales', doneKey: 'webhook_done', skipKey: 'webhook_skipped' },
  { id: 'attribution', title: 'Cookie attribution', desc: 'Add the tracking snippet to your checkout', doneKey: 'attribution_done', skipKey: 'attribution_skipped' },
]

export default function OnboardingPage() {
  const [user, setUser] = useState<any>(null)
  const [step, setStep] = useState(0)
  const [onboarding, setOnboarding] = useState<Record<string, boolean>>({})
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(u => {
      setUser(u)
      setOnboarding(u.onboarding || {})
    })
  }, [])

  const save = async (updates: Record<string, boolean>) => {
    const merged = { ...onboarding, ...updates }
    setOnboarding(merged)
    await fetch(`/api/clients/${user?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarding: merged }) })
  }

  const skip = async () => {
    const s = STEPS[step]
    await save({ [s.skipKey]: true })
    if (step < STEPS.length - 1) setStep(step + 1)
    else router.push('/dashboard')
  }

  const complete = async () => {
    const s = STEPS[step]
    setLoading(true)
    if (s.id === 'domain' && domain) {
      await fetch(`/api/clients/${user?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_domain: domain }) })
    }
    await save({ [s.doneKey]: true })
    setLoading(false)
    if (step < STEPS.length - 1) setStep(step + 1)
    else router.push('/dashboard')
  }

  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.korant.in'

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 40 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? '#d4a843' : '#1e1e1e' }} />
          ))}
        </div>

        <div style={{ fontSize: 13, color: '#4a4642', marginBottom: 8 }}>Step {step + 1} of {STEPS.length}</div>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#e8e4dc', marginBottom: 6 }}>{STEPS[step].title}</h1>
        <p style={{ fontSize: 13, color: '#5a5652', marginBottom: 32 }}>{STEPS[step].desc}</p>

        {/* Step content */}
        <div style={{ background: '#111', border: '0.5px solid #1e1e1e', borderRadius: 12, padding: 24, marginBottom: 24 }}>
          {step === 0 && (
            <div>
              <p style={{ fontSize: 13, color: '#7a7670', marginBottom: 16, lineHeight: 1.7 }}>Add a custom CNAME record to use your own domain for tracking links (e.g. <code style={{ background: '#1a1a1a', padding: '1px 5px', borderRadius: 3, fontSize: 12, color: '#d4a843' }}>track.yourbrand.com</code>).</p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Your custom domain</label>
                <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="track.yourbrand.com" style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '10px 14px', width: '100%', outline: 'none' }} />
              </div>
              <div style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8, padding: 14, fontSize: 12, color: '#5a5652', lineHeight: 1.8 }}>
                <div style={{ marginBottom: 6, color: '#4a4642', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>DNS record to add</div>
                <div><span style={{ color: '#3a3632' }}>Type:</span> CNAME</div>
                <div><span style={{ color: '#3a3632' }}>Name:</span> track</div>
                <div><span style={{ color: '#3a3632' }}>Value:</span> <span style={{ color: '#d4a843', fontFamily: 'monospace' }}>cname.korant.app</span></div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p style={{ fontSize: 13, color: '#7a7670', marginBottom: 16, lineHeight: 1.7 }}>Add the webhook URL to your store to enable sale attribution.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[{ label: 'Shopify', url: `${BASE_URL}/api/webhook/shopify`, note: 'Admin → Settings → Notifications → Webhooks → Order payment' },
                  { label: 'Razorpay', url: `${BASE_URL}/api/webhook/razorpay?clientId=${user?.id}`, note: 'Dashboard → Account Settings → Webhooks' },
                  { label: 'Generic', url: `${BASE_URL}/api/webhook/generic?clientId=${user?.id}`, note: 'POST with orderId, orderValue, discountCode, mkSlug' }].map(w => (
                  <div key={w.label} style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#c8c4bc', marginBottom: 6 }}>{w.label}</div>
                    <code style={{ fontSize: 11, color: '#d4a843', background: '#1a1400', padding: '4px 8px', borderRadius: 4, display: 'block', marginBottom: 6, wordBreak: 'break-all' }}>{w.url}</code>
                    <div style={{ fontSize: 11, color: '#3a3632' }}>{w.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: '#7a7670', marginBottom: 16, lineHeight: 1.7 }}>Add this snippet to your checkout/cart to pass attribution cookies with orders.</p>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#4a4642', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>Shopify (paste in order status page additional scripts)</div>
                <pre style={{ background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 8, padding: 14, fontSize: 11, color: '#7a7670', overflowX: 'auto', lineHeight: 1.6 }}>{`<script>
(function() {
  function getCookie(name) {
    return document.cookie.split('; ').find(r => r.startsWith(name + '='))?.split('=')[1] || '';
  }
  var slug = getCookie('mk_slug');
  var first = getCookie('mk_slug_first');
  if (slug) {
    fetch('/cart/update.js', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({attributes: {mk_slug: slug, mk_slug_first: first}})
    });
  }
})();
</script>`}</pre>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={skip} style={{ border: '0.5px solid #2a2a2a', color: '#5a5652', background: 'transparent', borderRadius: 7, padding: '10px 18px', fontSize: 13, cursor: 'pointer' }}>
            {step === STEPS.length - 1 ? 'Skip & go to dashboard' : 'Skip for now'}
          </button>
          <button onClick={complete} disabled={loading} style={{ border: '0.5px solid #d4a843', color: '#d4a843', background: 'transparent', borderRadius: 7, padding: '10px 24px', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving…' : step === STEPS.length - 1 ? 'Done → Dashboard' : 'Done → Next step'}
          </button>
        </div>
      </div>
    </div>
  )
}
