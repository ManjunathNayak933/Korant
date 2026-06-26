'use client'
import { useState, useEffect } from 'react'

interface Onboarding {
  tracking_domain?: string; store_url?: string
  domain_done?:    boolean; domain_skipped?:    boolean; domain_verified?:   boolean
  tracking_done?:  boolean; tracking_skipped?:  boolean; tracking_verified?: boolean
  webhook_done?:   boolean; webhook_skipped?:   boolean; webhook_verified?:  boolean
}
interface Props {
  user: { id: string; onboarding?: Onboarding }
  onClose: () => void
  onSave:  (ob: Onboarding) => void
}

export default function SetupModal({ user, onClose, onSave }: Props) {
  const [page,        setPage]        = useState(0)
  const [ob,          setOb]          = useState<Onboarding>(user.onboarding || {})
  const [checking,    setChecking]    = useState(false)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [trackingPlatform, setTrackingPlatform] = useState<'shopify'|'woo'|'custom'>('shopify')
  const [confirmStep, setConfirmStep] = useState<string | null>(null)

  // Step 3: a ready-to-paste webhook URL (cid + key baked in) for sale tracking,
  // plus a one-click "Connect Shopify" (OAuth) to enable auto-created codes. No
  // token-pasting — the OAuth callback stores the token for us.
  const [shopDomain,  setShopDomain]  = useState('')
  const [conn,        setConn]        = useState<{ webhook_url?: string; has_shopify_domain?: boolean; has_shopify_token?: boolean; shopify_domain?: string } | null>(null)
  const [urlCopied,   setUrlCopied]   = useState(false)
  const [connecting,  setConnecting]  = useState(false)
  const [showReconnect, setShowReconnect] = useState(false)

  useEffect(() => { setCheckResult(null); setConfirmStep(null) }, [page])

  // Load the pre-filled webhook URL + connection status. The integrations
  // endpoint generates the per-client key on first call, so the URL is ready
  // to copy with no action from the customer.
  useEffect(() => {
    fetch('/api/clients/integrations').then(r => r.json()).then((d) => {
      setConn(d)
      if (d?.shopify_domain) setShopDomain(d.shopify_domain)
    }).catch(() => {})
  }, [])

  // ── Live endpoints ────────────────────────────────────────────────────
  // The beacon + webhook live on the MicroKorant origin, NOT the merchant's
  // store, so every snippet pasted into a store theme must use the ABSOLUTE
  // origin below. `cid` is this client's id; the beacon route requires it.
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.microkorant.in'
  const CID = user.id

  // Count only _done (NOT _skipped) for progress
  const doneCount = [ob.domain_done, ob.tracking_done, ob.webhook_done].filter(Boolean).length

  const persist = async (updated: Onboarding) => {
    setSaving(true)
    try {
      const res  = await fetch('/api/auth/onboarding', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      const data = await res.json()
      const saved = data.onboarding || updated
      setOb(saved)
      onSave(saved)
    } catch {
      setOb(updated)
      onSave(updated)
    }
    setSaving(false)
  }

  const verify = async (type: string) => {
    setChecking(true)
    setCheckResult({ ok: false, msg: 'Checking...' })
    setConfirmStep(null)
    try {
      const res  = await fetch('/api/setup/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, trackingDomain: ob.tracking_domain, storeUrl: ob.store_url }),
      })
      const d = await res.json()
      setCheckResult({ ok: d.ok, msg: d.message })
      if (d.ok) {
        const verK: Record<string, keyof Onboarding> = { domain: 'domain_verified', tracking: 'tracking_verified', webhook: 'webhook_verified' }
        const doneK: Record<string, keyof Onboarding> = { domain: 'domain_done', tracking: 'tracking_done', webhook: 'webhook_done' }
        if (verK[type]) persist({ ...ob, [verK[type]]: true, [doneK[type]]: true })
      }
    } catch { setCheckResult({ ok: false, msg: 'Check failed. Try again.' }) }
    setChecking(false)
  }

  // Called when user clicks "Mark as done" without verifying
  const requestConfirm = (step: string) => {
    setConfirmStep(step)
    setCheckResult({ ok: false, msg: 'You have not verified this step. Click "Confirm anyway" to mark it done without verification.' })
  }

  const confirmDone = (doneKey: keyof Onboarding) => {
    persist({ ...ob, [doneKey]: true })
    setConfirmStep(null)
    setCheckResult({ ok: true, msg: 'Marked as done (unverified).' })
  }

  const skip = (skipKey: keyof Onboarding) => {
    persist({ ...ob, [skipKey]: true })
    setCheckResult(null)
  }

  const reset = (doneK: keyof Onboarding, skipK: keyof Onboarding, verK: keyof Onboarding) => {
    persist({ ...ob, [doneK]: false, [skipK]: false, [verK]: false })
    setCheckResult(null)
    setConfirmStep(null)
  }

  // Start the Shopify "Connect" (OAuth) flow. We only need the store address to
  // build the install link; the token comes back automatically via the callback,
  // which stores it for this client. A full-page navigation (not fetch) because
  // it redirects to Shopify and back.
  const connectShopify = () => {
    const shop = shopDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!shop) return
    setConnecting(true)
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(shop)}`
  }

  // ── Snippet builder ───────────────────────────────────────────────────
  // refCapture: read a partner ref off the landing URL (?ref= or ?mk=) and
  //   store it first-party on the store domain so checkout can forward it.
  // shopifyAttach (Shopify only): copy that ref onto the Shopify cart via
  //   /cart/update.js, so it lands in the order's note_attributes — which is
  //   exactly what /api/webhook/shopify reads (noteAttributes['mk_slug']).
  // beaconFire: pageview pixel to /api/beacon (GET image — sends cookies,
  //   needs no CORS). The route reads `cid`, `e`, `p`.
  const refCapture = `  function gc(n){var m=document.cookie.match('(^|;)\\\\s*'+n+'=([^;]+)');return m?m[2]:null}
  function sc(n,v,days){var e=new Date();e.setTime(e.getTime()+days*864e5);
    document.cookie=n+'='+v+';path=/;expires='+e.toUTCString()+';SameSite=Lax'}
  var ref=new URLSearchParams(location.search).get('ref')||new URLSearchParams(location.search).get('mk');
  if(ref){sc('mk_slug',ref,30);if(!gc('mk_slug_first'))sc('mk_slug_first',ref,90)}`

  const shopifyAttach = `
  var slug=gc('mk_slug'),first=gc('mk_slug_first');
  if(slug){fetch('/cart/update.js',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({attributes:{mk_slug:slug,mk_slug_first:first||''}})}).catch(function(){})}`

  const beaconFire = `
  new Image().src='${BASE_URL}/api/beacon?cid=${CID}&e=pageview&p='+encodeURIComponent(location.pathname)+'&t='+Date.now();`

  const snippet = `<!-- MicroKorant tracking — paste just before </body> -->
<script>
(function(){
${refCapture}${trackingPlatform === 'shopify' ? shopifyAttach : ''}${beaconFire}
})();
</script>`

  // Shopify thank-you page: record a purchase touchpoint for journey analytics.
  // (The actual sale + commission is attributed by the order webhook, page 3.)
  const orderStatusSnippet = `{% comment %} order-status.liquid — add at the bottom {% endcomment %}
{% if first_time_accessed %}
<script>
  new Image().src='${BASE_URL}/api/beacon?cid=${CID}&e=purchase&p=/checkout/complete&t='+Date.now();
</script>
{% endif %}`

  // Custom / headless conversion helper — also a GET beacon (e=lead).
  const customConvertSnippet = `<!-- Conversion helper — paste once anywhere on your site -->
<script>
function mkConvert(leadValue) {
  new Image().src='${BASE_URL}/api/beacon?cid=${CID}&e=lead'+
    '&p='+encodeURIComponent(location.pathname)+'&v='+(leadValue||0)+'&t='+Date.now();
}
</script>

<!-- Then call it wherever your conversion happens: -->

<!-- Form submit button -->
<button onclick="mkConvert(0)">Submit</button>

<!-- After a successful API call (e.g. sign-up) -->
yourSignupApi().then(function(r) {
  if (r.ok) mkConvert(2500); // optional: lead value in your currency
});

<!-- Demo / contact click -->
<a href="/demo" onclick="mkConvert(5000)">Book a demo</a>`

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text) }

  // ── Shared helpers ────────────────────────────────────────────────────
  const stepDone    = (p: string) => p==='domain'?ob.domain_done:p==='tracking'?ob.tracking_done:ob.webhook_done
  const stepSkip    = (p: string) => p==='domain'?ob.domain_skipped:p==='tracking'?ob.tracking_skipped:ob.webhook_skipped
  const stepVerif   = (p: string) => p==='domain'?ob.domain_verified:p==='tracking'?ob.tracking_verified:ob.webhook_verified

  const StatusBadge = ({ step }: { step: string }) => {
    const done = stepDone(step), skip = stepSkip(step), verif = stepVerif(step)
    return (
      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4,
        background: done ? '#4a7c3f18' : skip ? 'var(--surface2)' : 'var(--surface)',
        color:      done ? '#4a7c3f'   : skip ? 'var(--text-dim)' : 'var(--text-dim)',
        border:    `0.5px solid ${done ? '#4a7c3f55' : 'var(--border2)'}` }}>
        {done ? (verif ? '✓ verified' : '✓ done (unverified)') : skip ? 'skipped' : 'pending'}
      </span>
    )
  }

  const CheckBanner = () => checkResult ? (
    <div style={{ margin: '12px 0', padding: '9px 14px', borderRadius: 7, fontSize: 12, lineHeight: 1.5,
      background: checkResult.ok ? '#4a7c3f18' : 'rgba(180,60,60,0.1)',
      border: `0.5px solid ${checkResult.ok ? '#4a7c3f55' : 'rgba(180,60,60,.3)'}`,
      color: checkResult.ok ? '#4a7c3f' : 'var(--text-secondary)' }}>
      {checkResult.msg}
    </div>
  ) : null

  const Btn = ({ primary, disabled, onClick, label }: { primary?: boolean; disabled?: boolean; onClick: () => void; label: string }) => (
    <button onClick={onClick} disabled={disabled} style={{ padding: '8px 16px', borderRadius: 7,
      border: primary ? 'none' : '0.5px solid var(--border2)',
      background: primary ? 'var(--amber)' : 'transparent',
      color: primary ? '#0d0d0d' : 'var(--text-muted)',
      fontWeight: primary ? 500 : 400, fontSize: 13,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, fontFamily: 'var(--font-sans)' }}>{label}</button>
  )

  const PAGES = ['domain', 'tracking', 'webhook', 'extras']
  const cur = PAGES[page]

  // ── Page titles ───────────────────────────────────────────────────────
  const PAGE_TITLES: Record<string, string> = {
    domain:   'Custom tracking domain',
    tracking: 'Store tracking script',
    webhook:  'Order webhook',
    extras:   'WhatsApp & Analytics',
  }
  const PAGE_SUBS: Record<string, string> = {
    domain:   'CNAME setup — optional but professional',
    tracking: 'Beacon + attribution — one snippet does both',
    webhook:  'Sale attribution — so orders reach MicroKorant',
    extras:   'Optional integrations',
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'var(--bg)', border:'0.5px solid var(--border)', borderRadius:14,
        width:'100%', maxWidth:560, maxHeight:'92vh', display:'flex', flexDirection:'column' }}>

        {/* ── Header ── */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'0.5px solid var(--border)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:10, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.5px' }}>
                  Step {page+1} of 4
                </span>
                {page < 3 && <StatusBadge step={cur} />}
              </div>
              <div style={{ fontSize:15, fontWeight:500, color:'var(--text-primary)' }}>{PAGE_TITLES[cur]}</div>
              <div style={{ fontSize:11, color:'var(--text-dim)', marginTop:2 }}>{PAGE_SUBS[cur]}</div>
            </div>
            <button onClick={onClose} style={{ background:'transparent', border:'none', color:'var(--text-dim)', fontSize:18, cursor:'pointer', padding:'2px 6px' }}>✕</button>
          </div>
          {/* Progress bar */}
          <div style={{ marginTop:12, height:3, background:'var(--border2)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${(doneCount/3)*100}%`, background:'var(--amber)', borderRadius:2, transition:'width .3s' }}/>
          </div>
          <div style={{ marginTop:4, fontSize:10, color:'var(--text-dim)' }}>{doneCount}/3 core steps complete</div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>

          {/* PAGE 1 — Domain */}
          {cur==='domain'&&(
            <div>
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:14 }}>
                Add a CNAME record in your DNS so tracking links show your brand name. Optional, but more professional — and it makes the tracking cookie first-party to your store, which improves cookie-based sale attribution.
              </p>
              <div style={{ background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:8, padding:'12px 16px', marginBottom:14 }}>
                <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--text-dim)', marginBottom:8 }}>DNS record to add</div>
                <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
                  <thead>
                    <tr>{['Type','Name','Points to'].map(h=><th key={h} style={{ textAlign:'left', padding:'4px 8px', color:'var(--text-dim)', fontSize:10, fontWeight:400 }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>{['CNAME','tracking','tracking.microkorant.in'].map((c,i)=><td key={i} style={{ padding:'5px 8px', background:'var(--surface)', borderRadius:4, fontFamily:'var(--font-mono)', color:'var(--amber)', fontSize:11 }}>{c}</td>)}</tr>
                  </tbody>
                </table>
              </div>
              <input value={ob.tracking_domain||''} onChange={e=>setOb(p=>({...p,tracking_domain:e.target.value}))}
                placeholder="tracking.yourbrand.com"
                style={{ width:'100%', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:7, padding:'9px 13px', fontSize:13, color:'var(--text-primary)', fontFamily:'var(--font-mono)', outline:'none' }}/>
              <CheckBanner/>
              <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap', alignItems:'center' }}>
                <Btn primary disabled={!ob.tracking_domain||checking} onClick={()=>verify('domain')}
                  label={checking?'Checking DNS...':'Check CNAME ↗'}/>
                {!ob.domain_done&&!confirmStep&&(
                  <Btn disabled={false} onClick={()=>requestConfirm('domain')} label="Mark as done"/>
                )}
                {confirmStep==='domain'&&(
                  <Btn primary={false} disabled={false} onClick={()=>confirmDone('domain_done')}
                    label="Confirm anyway (skip verify)"/>
                )}
                {!ob.domain_skipped&&!ob.domain_done&&(
                  <button onClick={()=>skip('domain_skipped')} style={{ marginLeft:'auto', background:'transparent', border:'none', color:'var(--text-dim)', fontSize:12, cursor:'pointer' }}>Skip for now</button>
                )}
                {(ob.domain_done||ob.domain_skipped)&&(
                  <button onClick={()=>reset('domain_done','domain_skipped','domain_verified')} style={{ marginLeft:'auto', background:'transparent', border:'0.5px solid var(--border2)', color:'var(--text-dim)', borderRadius:6, padding:'5px 10px', fontSize:11, cursor:'pointer' }}>Reset</button>
                )}
              </div>
            </div>
          )}

          {/* PAGE 2 — Tracking script */}
          {cur==='tracking'&&(
            <div>
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:12 }}>
                One snippet handles both visitor analytics (Unique/Returned/Shared) and sale attribution. Works alongside Google Analytics — no conflict. Select your platform:
              </p>

              {/* Platform tabs */}
              <div style={{ display:'flex', gap:0, borderBottom:'0.5px solid var(--border2)', marginBottom:14 }}>
                {(['shopify','woo','custom'] as const).map(p => (
                  <button key={p} onClick={()=>setTrackingPlatform(p)} style={{ padding:'6px 14px', fontSize:12, border:'none', background:'transparent', color:trackingPlatform===p?'var(--amber)':'var(--text-dim)', borderBottom:`2px solid ${trackingPlatform===p?'var(--amber)':'transparent'}`, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
                    {p==='shopify'?'Shopify':p==='woo'?'WooCommerce':'Custom / Other'}
                  </button>
                ))}
              </div>

              {/* Shopify instructions */}
              {trackingPlatform==='shopify'&&(
                <div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.9, marginBottom:10 }}>
                    <strong style={{ color:'var(--text-secondary)', display:'block', marginBottom:2 }}>Step 1 — All pages (visitor tracking + attribution)</strong>
                    Go to <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>Admin → Online Store → Themes → ••• → Edit code</code><br/>
                    Open <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>Layout / theme.liquid</code><br/>
                    Find <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>{'</body>'}</code> near the very bottom. Paste the main script (below) just above it.<br/>
                    <span style={{ color:'var(--text-dim)', fontSize:11 }}>This script also copies the partner tag onto the Shopify cart, so the order carries it for the webhook to attribute. Google Analytics goes in {'<head>'}; ours goes before {'</body>'} — same file, no conflict.</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.9, marginBottom:8 }}>
                    <strong style={{ color:'var(--text-secondary)', display:'block', marginBottom:2 }}>Step 2 — Order confirmation (purchase signal)</strong>
                    In the same Edit code panel, open <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>order-status.liquid</code> and paste this at the bottom.<br/>
                    <span style={{ color:'var(--text-dim)', fontSize:11 }}>This records the purchase in the visitor journey. The actual sale &amp; commission are attributed by the order webhook in Step 3 — <code style={{ background:'var(--surface2)', padding:'1px 4px', borderRadius:3 }}>first_time_accessed</code> stops double-counting on refresh.</span>
                  </div>
                  <div style={{ position:'relative', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:7, padding:'10px 12px', marginBottom:12 }}>
                    <pre style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', margin:0, whiteSpace:'pre-wrap', lineHeight:1.5 }}>{orderStatusSnippet}</pre>
                    <button onClick={()=>copyToClipboard(orderStatusSnippet)} style={{ position:'absolute', top:6, right:6, background:'var(--surface)', border:'0.5px solid var(--border2)', color:'var(--text-dim)', borderRadius:4, padding:'2px 7px', fontSize:10, cursor:'pointer' }}>Copy</button>
                  </div>
                </div>
              )}

              {/* WooCommerce instructions */}
              {trackingPlatform==='woo'&&(
                <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.9, marginBottom:12 }}>
                  <strong style={{ color:'var(--text-secondary)', display:'block', marginBottom:2 }}>Option A — Edit theme file</strong>
                  Go to <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>Appearance → Theme Editor → footer.php</code><br/>
                  Paste the main script just before <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>{'</body>'}</code>.<br/><br/>
                  <strong style={{ color:'var(--text-secondary)', display:'block', marginBottom:2 }}>Option B — Plugin (easier, no code editing)</strong>
                  Install the <em>Insert Headers and Footers</em> plugin → paste the script in the <strong>Footer</strong> section. Saves and applies to all pages automatically.<br/>
                  <span style={{ color:'var(--text-dim)', fontSize:11 }}>For sale attribution on WooCommerce, use the order webhook in Step 3.</span>
                </div>
              )}

              {/* Custom instructions */}
              {trackingPlatform==='custom'&&(
                <div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.9, marginBottom:10 }}>
                    <strong style={{ color:'var(--text-secondary)', display:'block', marginBottom:2 }}>Step 1 — All pages (visit tracking)</strong>
                    Paste the main script below just before <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>{'</body>'}</code> in your master layout file — the one file that wraps every page.<br/>
                    <span style={{ color:'var(--text-dim)', fontSize:11 }}>Using a tag manager? Add a Custom HTML tag firing on All Pages.</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.9, marginBottom:8 }}>
                    <strong style={{ color:'var(--text-secondary)', display:'block', marginBottom:2 }}>Step 2 — Conversion tracking (no checkout needed)</strong>
                    Call <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontSize:11 }}>mkConvert()</code> whenever your meaningful action happens — form submit, sign-up, demo request, trial activation. This replaces the order webhook entirely.<br/>
                    <span style={{ color:'var(--text-dim)', fontSize:11 }}>Optionally pass a lead value (e.g. your CRM value per lead). Leave 0 if unknown.</span>
                  </div>
                  <div style={{ position:'relative', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:7, padding:'10px 12px', marginBottom:12 }}>
                    <pre style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', margin:0, whiteSpace:'pre-wrap', lineHeight:1.6 }}>{customConvertSnippet}</pre>
                    <button onClick={()=>copyToClipboard(customConvertSnippet)} style={{ position:'absolute', top:6, right:6, background:'var(--surface)', border:'0.5px solid var(--border2)', color:'var(--text-dim)', borderRadius:4, padding:'2px 7px', fontSize:10, cursor:'pointer' }}>Copy</button>
                  </div>
                  <div style={{ padding:'10px 14px', background:'var(--surface)', border:'0.5px solid var(--border2)', borderRadius:8, fontSize:11, color:'var(--text-dim)', lineHeight:1.7 }}>
                    <strong style={{ color:'var(--text-secondary)' }}>What you can track without a checkout:</strong><br/>
                    ✓ Clicks per partner &nbsp;·&nbsp; ✓ Unique / Returned / Shared visitors &nbsp;·&nbsp; ✓ Conversion rate (leads ÷ clicks) &nbsp;·&nbsp; ✓ Lead value if you pass one<br/>
                    ✗ Order-level detail &nbsp;·&nbsp; ✗ Discount code redemptions
                  </div>
                </div>
              )}

              {/* Main snippet — platform-aware */}
              <div style={{ fontSize:11, fontWeight:500, color:'var(--text-secondary)', marginBottom:6 }}>
                Main tracking script — paste in {trackingPlatform==='shopify'?'theme.liquid before </body>':trackingPlatform==='woo'?'footer.php before </body>':'your master layout before </body>'}
              </div>
              <div style={{ position:'relative', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
                <pre style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', margin:0, whiteSpace:'pre-wrap', wordBreak:'break-all', lineHeight:1.5, maxHeight:160, overflow:'auto' }}>{snippet}</pre>
                <button onClick={()=>{copyToClipboard(snippet);setCopied(true);setTimeout(()=>setCopied(false),2000)}}
                  style={{ position:'absolute', top:8, right:8, background:'var(--surface)', border:'0.5px solid var(--border2)', color:'var(--text-dim)', borderRadius:4, padding:'3px 8px', fontSize:10, cursor:'pointer' }}>
                  {copied?'✓ Copied':'Copy'}
                </button>
              </div>

              <input value={ob.store_url||''} onChange={e=>setOb(p=>({...p,store_url:e.target.value}))}
                placeholder="https://yourstore.com"
                style={{ width:'100%', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:7, padding:'9px 13px', fontSize:13, color:'var(--text-primary)', outline:'none' }}/>
              <CheckBanner/>
              <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap', alignItems:'center' }}>
                <Btn primary disabled={!ob.store_url||checking} onClick={()=>verify('tracking')}
                  label={checking?'Checking...':'Verify script is live'}/>
                {!ob.tracking_done&&!confirmStep&&(
                  <Btn disabled={false} onClick={()=>requestConfirm('tracking')} label="Mark as done"/>
                )}
                {confirmStep==='tracking'&&(
                  <Btn primary={false} disabled={false} onClick={()=>confirmDone('tracking_done')}
                    label="Confirm anyway (skip verify)"/>
                )}
                {!ob.tracking_skipped&&!ob.tracking_done&&(
                  <button onClick={()=>skip('tracking_skipped')} style={{ marginLeft:'auto', background:'transparent', border:'none', color:'var(--text-dim)', fontSize:12, cursor:'pointer' }}>Skip for now</button>
                )}
                {(ob.tracking_done||ob.tracking_skipped)&&(
                  <button onClick={()=>reset('tracking_done','tracking_skipped','tracking_verified')} style={{ marginLeft:'auto', background:'transparent', border:'0.5px solid var(--border2)', color:'var(--text-dim)', borderRadius:6, padding:'5px 10px', fontSize:11, cursor:'pointer' }}>Reset</button>
                )}
              </div>
            </div>
          )}

          {/* PAGE 3 — Webhook */}
          {cur==='webhook'&&(
            <div>
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:16 }}>
                Just one step: copy your tracking link below, then paste it into Shopify. That's what lets us see your sales and credit the right partner. Takes about two minutes.
              </p>

              {/* Step 1 — copy the link */}
              <div style={{ display:'flex', gap:10, marginBottom:14 }}>
                <div style={{ flexShrink:0, width:22, height:22, borderRadius:11, background:'var(--amber)', color:'#0d0d0d', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center' }}>1</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:'var(--text-secondary)', fontWeight:500, marginBottom:8 }}>Copy your tracking link</div>
                  <div style={{ position:'relative', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:8, padding:'12px 14px' }}>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--amber)', userSelect:'all', wordBreak:'break-all', paddingRight:54, lineHeight:1.5 }}>
                      {conn?.webhook_url || 'Loading your link…'}
                    </div>
                    <button onClick={()=>{ if(conn?.webhook_url){ copyToClipboard(conn.webhook_url); setUrlCopied(true); setTimeout(()=>setUrlCopied(false),2000) } }}
                      style={{ position:'absolute', top:9, right:9, background:'var(--amber)', border:'none', color:'#0d0d0d', fontWeight:500, borderRadius:4, padding:'4px 10px', fontSize:11, cursor:'pointer' }}>
                      {urlCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 2 — paste into Shopify */}
              <div style={{ display:'flex', gap:10, marginBottom:14 }}>
                <div style={{ flexShrink:0, width:22, height:22, borderRadius:11, background:'var(--amber)', color:'#0d0d0d', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center' }}>2</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:'var(--text-secondary)', fontWeight:500, marginBottom:6 }}>Add it in Shopify</div>
                  <div style={{ fontSize:12.5, color:'var(--text-muted)', lineHeight:1.85 }}>
                    In your Shopify admin, go to <strong style={{ color:'var(--text-secondary)' }}>Settings → Notifications → Webhooks</strong>, then click <strong style={{ color:'var(--text-secondary)' }}>Create webhook</strong> and fill in:
                  </div>
                  <div style={{ marginTop:8, display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 14px', fontSize:12.5, alignItems:'baseline' }}>
                    <div style={{ color:'var(--text-dim)' }}>Event</div><div style={{ color:'var(--text-secondary)' }}>Order payment</div>
                    <div style={{ color:'var(--text-dim)' }}>Format</div><div style={{ color:'var(--text-secondary)' }}>JSON</div>
                    <div style={{ color:'var(--text-dim)' }}>URL</div><div style={{ color:'var(--text-secondary)' }}>paste the link you copied</div>
                  </div>
                  <div style={{ fontSize:12.5, color:'var(--text-muted)', lineHeight:1.85, marginTop:8 }}>
                    Click <strong style={{ color:'var(--text-secondary)' }}>Save</strong>. (On WooCommerce: Settings → Advanced → Webhooks.)
                  </div>
                </div>
              </div>

              {/* Step 3 — done */}
              <div style={{ display:'flex', gap:10, marginBottom:14 }}>
                <div style={{ flexShrink:0, width:22, height:22, borderRadius:11, background:'#4a7c3f', color:'#fff', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center' }}>✓</div>
                <div style={{ flex:1, paddingTop:2 }}>
                  <div style={{ fontSize:13, color:'var(--text-secondary)', fontWeight:500 }}>That's it — your sales now track automatically</div>
                  <div style={{ fontSize:12, color:'var(--text-dim)', marginTop:2, lineHeight:1.6 }}>
                    Use the button below to check it's working once you've placed a test order.
                  </div>
                </div>
              </div>

              {/* Auto-create discount codes — one-click Shopify connect (OAuth) */}
              <div style={{ background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:13, color:'var(--text-secondary)', fontWeight:500, marginBottom:2 }}>
                  Auto-create discount codes{conn?.has_shopify_token && <span style={{ color:'#4a7c3f', fontWeight:400 }}> · connected ✓</span>}
                </div>

                {conn?.has_shopify_token ? (
                  <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7 }}>
                    Your store{conn.shopify_domain ? <> (<span style={{ fontFamily:'var(--font-mono)' }}>{conn.shopify_domain}</span>)</> : ''} is connected. Every partner code you create in MicroKorant is now created in Shopify automatically.
                    <div style={{ marginTop:8 }}>
                      <button onClick={()=>setShowReconnect(v=>!v)} style={{ background:'transparent', border:'none', color:'var(--text-dim)', fontSize:11, cursor:'pointer', padding:0, textDecoration:'underline' }}>
                        Reconnect a different store
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7, marginBottom:12 }}>
                    Connect your store and MicroKorant creates each partner's discount code in Shopify for you — no copying codes by hand. One click; you approve on Shopify and you're back here.
                  </div>
                )}

                {(!conn?.has_shopify_token || showReconnect) && (
                  <div style={{ marginTop: conn?.has_shopify_token ? 10 : 0 }}>
                    <label style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.4px', color:'var(--text-dim)', display:'block', marginBottom:4 }}>
                      Your Shopify store address
                    </label>
                    <input value={shopDomain} onChange={e=>setShopDomain(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Enter') connectShopify() }}
                      placeholder="yourstore.myshopify.com"
                      style={{ width:'100%', background:'var(--surface)', border:'0.5px solid var(--border2)', borderRadius:7, padding:'9px 13px', fontSize:13, color:'var(--text-primary)', fontFamily:'var(--font-mono)', outline:'none', marginBottom:10 }}/>
                    <Btn primary disabled={connecting || !shopDomain.trim()} onClick={connectShopify} label={connecting ? 'Opening Shopify…' : 'Connect Shopify'}/>
                  </div>
                )}

                <div style={{ marginTop:10, fontSize:11, color:'var(--text-dim)', lineHeight:1.6 }}>
                  Optional — sale tracking above works without this. Skip it and your codes are saved in MicroKorant; you'd just add each one in your Shopify Discounts page.
                </div>
              </div>
              <CheckBanner/>
              <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap', alignItems:'center' }}>
                <Btn primary disabled={checking} onClick={()=>verify('webhook')}
                  label={checking?'Checking...':'Verify (checks recent orders)'}/>
                {!ob.webhook_done&&!confirmStep&&(
                  <Btn disabled={false} onClick={()=>requestConfirm('webhook')} label="Mark as done"/>
                )}
                {confirmStep==='webhook'&&(
                  <Btn primary={false} disabled={false} onClick={()=>confirmDone('webhook_done')}
                    label="Confirm anyway (skip verify)"/>
                )}
                {!ob.webhook_skipped&&!ob.webhook_done&&(
                  <button onClick={()=>skip('webhook_skipped')} style={{ marginLeft:'auto', background:'transparent', border:'none', color:'var(--text-dim)', fontSize:12, cursor:'pointer' }}>Skip for now</button>
                )}
                {(ob.webhook_done||ob.webhook_skipped)&&(
                  <button onClick={()=>reset('webhook_done','webhook_skipped','webhook_verified')} style={{ marginLeft:'auto', background:'transparent', border:'0.5px solid var(--border2)', color:'var(--text-dim)', borderRadius:6, padding:'5px 10px', fontSize:11, cursor:'pointer' }}>Reset</button>
                )}
              </div>
            </div>
          )}

          {/* PAGE 4 — Extras */}
          {cur==='extras'&&(
            <div>
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:18 }}>
                Optional integrations. Not required for core attribution.
              </p>
              {[{type:'whatsapp',icon:'💬',title:'WhatsApp',sub:'Campaigns & messaging'},{type:'analytics',icon:'📊',title:'Google Search Console',sub:'Keyword & ranking data'}].map(({type,icon,title,sub})=>(
                <div key={type} style={{ background:'var(--surface)', border:'0.5px solid var(--border)', borderRadius:10, padding:'14px 16px', marginBottom:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:20 }}>{icon}</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)' }}>{title}</div>
                      <div style={{ fontSize:11, color:'var(--text-dim)' }}>{sub}</div>
                    </div>
                  </div>
                  <button onClick={async()=>{
                    setChecking(true);setCheckResult({ok:false,msg:'Checking...'})
                    const r=await fetch('/api/setup/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type})})
                    const d=await r.json();setCheckResult({ok:d.ok,msg:d.message});setChecking(false)
                  }} disabled={checking}
                    style={{ background:'transparent', border:'0.5px solid var(--border2)', color:'var(--text-muted)', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer', opacity:checking?0.5:1 }}>
                    {checking?'...':'Check'}
                  </button>
                </div>
              ))}
              <CheckBanner/>
              <div style={{ marginTop:14, padding:'12px 16px', background:'var(--surface2)', borderRadius:8, fontSize:12, color:'var(--text-dim)', lineHeight:1.6 }}>
                To connect WhatsApp go to the WhatsApp tab. For Search Console go to the Search Console tab.
              </div>
            </div>
          )}
        </div>

        {/* ── Footer — page dots + nav ── */}
        <div style={{ padding:'14px 24px', borderTop:'0.5px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          {/* Dots */}
          <div style={{ display:'flex', gap:6 }}>
            {PAGES.map((p,i)=>(
              <button key={p} onClick={()=>setPage(i)} style={{
                width: i===page?20:6, height:6, borderRadius:3,
                background: i===page?'var(--amber)':i<page?'#4a7c3f55':'var(--border2)',
                border:'none', cursor:'pointer', transition:'all .2s',
              }}/>
            ))}
          </div>
          {/* Nav */}
          <div style={{ display:'flex', gap:8 }}>
            {page>0&&<Btn onClick={()=>setPage(p=>p-1)} label="← Back"/>}
            {page<3
              ?<Btn primary onClick={()=>setPage(p=>p+1)} label="Next →"/>
              :<Btn primary onClick={onClose} label={saving?'Saving...':'Finish'}/>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
