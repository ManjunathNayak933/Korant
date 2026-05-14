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
  // Requires explicit confirmation before "mark as done" if not verified
  const [confirmStep, setConfirmStep] = useState<string | null>(null)

  useEffect(() => { setCheckResult(null); setConfirmStep(null) }, [page])

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

  const snippet = `<!-- MicroKorant tracking — paste just before </body> -->
<script>
(function(){
  var d=document,s='kv_partner',u='kv_id';
  function gc(n){var m=d.cookie.match('(^|;)\\s*'+n+'=([^;]+)');return m?m[2]:null}
  function sc(n,v,days){var e=new Date();e.setTime(e.getTime()+days*864e5);
    d.cookie=n+'='+v+';path=/;expires='+e.toUTCString()+';SameSite=Lax'}
  var p=new URLSearchParams(location.search).get('kv')||gc(s);
  if(p)sc(s,p,90);
  if(!gc(u))sc(u,Math.random().toString(36).slice(2),365);
  fetch('/api/beacon',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({visitor_id:gc(u),partner_slug:gc(s),
      page:location.pathname,referrer:document.referrer})}).catch(function(){});
})();
</script>`

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
                Add a CNAME record in your DNS so tracking links show your brand name. Optional, but more professional.
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
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:10 }}>
                One snippet does both jobs: visitor analytics (Unique/Returned/Shared) and sale attribution. Paste before <code style={{ background:'var(--surface2)', padding:'1px 5px', borderRadius:3, fontFamily:'var(--font-mono)', fontSize:12 }}>&lt;/body&gt;</code>. Works alongside Google Analytics — no conflicts.
              </p>
              <div style={{ position:'relative', background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
                <pre style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', margin:0, whiteSpace:'pre-wrap', wordBreak:'break-all', lineHeight:1.5, maxHeight:160, overflow:'auto' }}>{snippet}</pre>
                <button onClick={()=>{navigator.clipboard.writeText(snippet);setCopied(true);setTimeout(()=>setCopied(false),2000)}}
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
              <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, marginBottom:14 }}>
                Add this webhook in your store admin so MicroKorant knows when a purchase happens.
              </p>
              <div style={{ background:'var(--surface2)', border:'0.5px solid var(--border2)', borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--text-dim)', marginBottom:8 }}>Endpoint URL</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--amber)', userSelect:'all', marginBottom:14 }}>
                  https://www.microkorant.in/api/webhook/orders
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:12 }}>
                  {[['Shopify','Settings → Notifications → Webhooks'],['WooCommerce','WooCommerce → Settings → Advanced → Webhooks'],['Event','orders/paid'],['Format','JSON']].map(([k,v],i)=>(
                    <div key={i} style={{ background:'var(--surface)', borderRadius:5, padding:'8px 10px' }}>
                      <div style={{ color:'var(--text-dim)', fontSize:10, marginBottom:2 }}>{k}</div>
                      <div style={{ color:'var(--text-secondary)', fontSize:11 }}>{v}</div>
                    </div>
                  ))}
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