'use client'
import { useState } from 'react'
import RetentionPanel from './RetentionPanel'
import JourneyExplorer from './JourneyExplorer'

interface Props { clientId?: string; month?: string }

const TABS = [
  { id: 'retention', label: '↩️ Retention',        desc: 'Who came back, when, and from which channel' },
  { id: 'journey',   label: '🗺️ Journey Explorer',  desc: 'Cross-channel paths, attribution models, channel assist' },
  { id: 'beacon',    label: '📡 Tracking Setup',     desc: 'Install beacon on your store to track return visits' },
]

function BeaconSetup({ clientId }: { clientId?: string }) {
  const beaconUrl = `https://www.microkorant.in/api/beacon?cid=${clientId || 'YOUR_CLIENT_ID'}`
  const [copied, setCopied] = useState('')
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }
  const snippets = {
    head: `<!-- MicroKorant Tracking Beacon -->
<script>
  (function() {
    var img = new Image();
    img.src = '${beaconUrl}&p=' + encodeURIComponent(window.location.pathname) + '&_=' + Date.now();
  })();
</script>`,
    purchase: `<!-- On purchase confirmation page only -->
<script>
  (function() {
    var img = new Image();
    img.src = '${beaconUrl}&e=purchase&_=' + Date.now();
  })();
</script>`,
    shopify: `{% comment %} Add to theme.liquid inside <head> {% endcomment %}
<script>
  (function() {
    var img = new Image();
    img.src = '${beaconUrl}&p={{ request.path | url_encode }}&_=' + Date.now();
  })();
</script>

{% comment %} Add to order-status.liquid or thank_you.liquid {% endcomment %}
{% if first_time_accessed %}
<script>
  (function() {
    var img = new Image();
    img.src = '${beaconUrl}&e=purchase&_=' + Date.now();
  })();
</script>
{% endif %}`,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--amber)', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amber)', marginBottom: 6 }}>⚡️ Why you need this</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          The beacon is a tiny invisible image that fires on every page load at your store. It tells Korant when a visitor who originally came via a tracked link comes back organically — even if they didn't click a tracked link the second time. Without it, Retention and Journey data will only show direct tracked clicks.
        </div>
      </div>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Your Beacon URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <code style={{ flex: 1, padding: '7px 10px', background: 'var(--surface2)', borderRadius: 5, fontSize: 10, color: 'var(--text-secondary)', overflowX: 'auto', whiteSpace: 'nowrap' }}>{beaconUrl}</code>
          <button onClick={() => copy(beaconUrl, 'url')} style={{ padding: '6px 12px', borderRadius: 5, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>{copied === 'url' ? '✓' : 'Copy'}</button>
        </div>
      </div>
      {[
        { key: 'head',     title: 'Step 1 — Every page',         sub: 'Add inside <head> of your store layout', code: snippets.head },
        { key: 'purchase', title: 'Step 2 — Purchase page only', sub: 'Add on order confirmation / thank-you page', code: snippets.purchase },
        { key: 'shopify',  title: 'Shopify combined snippet',    sub: 'Use this if you are on Shopify', code: snippets.shopify },
      ].map(s => (
        <div key={s.key} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{s.title}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{s.sub}</div>
            </div>
            <button onClick={() => copy(s.code, s.key)} style={{ padding: '4px 10px', borderRadius: 5, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>
              {copied === s.key ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <pre style={{ margin: 0, padding: '9px 10px', background: 'var(--surface2)', borderRadius: 5, fontSize: 10, color: 'var(--text-secondary)', overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre' }}>{s.code}</pre>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsDashboard({ clientId, month }: Props) {
  const [activeTab, setActiveTab] = useState('retention')
  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border)', marginBottom: 24 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 18px', fontSize: 12, border: 'none', whiteSpace: 'nowrap',
            borderBottom: `2px solid ${activeTab === tab.id ? 'var(--amber)' : 'transparent'}`,
            background: 'transparent', color: activeTab === tab.id ? 'var(--amber)' : 'var(--text-muted)',
            cursor: 'pointer', fontWeight: activeTab === tab.id ? 500 : 400,
          }}>{tab.label}</button>
        ))}
      </div>
      <div style={{ marginBottom: 20, fontSize: 12, color: 'var(--text-dim)' }}>
        {TABS.find(t => t.id === activeTab)?.desc}
      </div>
      {activeTab === 'retention' && <RetentionPanel  clientId={clientId} month={month} />}
      {activeTab === 'journey'   && <JourneyExplorer clientId={clientId} month={month} />}
      {activeTab === 'beacon'    && <BeaconSetup     clientId={clientId} />}
    </div>
  )
}