'use client'
import { useState } from 'react'
import RetentionPanel from './RetentionPanel'
import JourneyExplorer from './JourneyExplorer'
import PartnerInsights from './PartnerInsights'

interface Props {
  clientId?: string
  month?: string
}

const TABS = [
  { id: 'retention',  label: '↩️ Retention',          desc: 'Who came back and when' },
  { id: 'journey',    label: '🗺️ Journey Explorer',     desc: 'Cross-channel paths & attribution' },
  { id: 'partners',   label: '🔬 Partner Insights',     desc: 'Reach, freshness & overlap' },
  { id: 'beacon',     label: '📡 Tracking Setup',       desc: 'Install beacon on your store' },
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
    purchase: `<!-- On purchase confirmation page -->
<script>
  (function() {
    var img = new Image();
    img.src = '${beaconUrl}&e=purchase&p=' + encodeURIComponent(window.location.pathname) + '&_=' + Date.now();
  })();
</script>`,
    shopify: `{% comment %} Add to theme.liquid <head> {% endcomment %}
<script>
  (function() {
    var img = new Image();
    img.src = '${beaconUrl}&p={{ request.path | url_encode }}&_=' + Date.now();
  })();
</script>

{% comment %} Add to order confirmation page {% endcomment %}
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
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The tracking beacon is a tiny invisible image that fires on every page load at your store. It lets Korant know when a visitor who originally came via an influencer/affiliate/SEO link comes back organically — even if they didn't click a tracked link the second time. Without it, return visits and cross-channel journeys cannot be measured.
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Step 1 — Your Beacon URL</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10 }}>This is your unique tracking URL. Do not share it publicly.</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{ flex: 1, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', overflowX: 'auto', whiteSpace: 'nowrap' }}>{beaconUrl}</code>
          <button onClick={() => copy(beaconUrl, 'url')} style={{ padding: '7px 14px', borderRadius: 6, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {copied === 'url' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {[
        { key: 'head',     title: 'Step 2 — Add to every page', sub: 'Paste in <head> of your store layout/theme file', code: snippets.head },
        { key: 'purchase', title: 'Step 3 — Add to purchase confirmation page', sub: 'Paste on your order confirmed / thank-you page', code: snippets.purchase },
        { key: 'shopify',  title: 'Shopify specific', sub: 'If using Shopify, use this combined snippet', code: snippets.shopify },
      ].map(s => (
        <div key={s.key} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{s.title}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{s.sub}</div>
            </div>
            <button onClick={() => copy(s.code, s.key)} style={{ padding: '5px 12px', borderRadius: 5, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>
              {copied === s.key ? '✓ Copied' : 'Copy code'}
            </button>
          </div>
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6, fontSize: 10, color: 'var(--text-secondary)', overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre' }}>{s.code}</pre>
        </div>
      ))}

      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          💡 <strong>How it works:</strong> When someone clicks your influencer link, Korant sets a cookie. When they come back to your store (even without clicking a link), the beacon fires, sees the cookie, and records the return visit. No personal data is stored — only an anonymous visitor ID.
        </div>
      </div>
    </div>
  )
}

export default function AnalyticsDashboard({ clientId, month }: Props) {
  const [activeTab, setActiveTab] = useState('retention')

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border)', marginBottom: 24, overflowX: 'auto' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 18px', fontSize: 12, border: 'none', whiteSpace: 'nowrap',
            borderBottom: `2px solid ${activeTab === tab.id ? 'var(--amber)' : 'transparent'}`,
            background: 'transparent', color: activeTab === tab.id ? 'var(--amber)' : 'var(--text-muted)',
            cursor: 'pointer', fontWeight: activeTab === tab.id ? 500 : 400,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab description */}
      <div style={{ marginBottom: 20, fontSize: 12, color: 'var(--text-dim)' }}>
        {TABS.find(t => t.id === activeTab)?.desc}
      </div>

      {activeTab === 'retention'  && <RetentionPanel   clientId={clientId} month={month} />}
      {activeTab === 'journey'    && <JourneyExplorer  clientId={clientId} month={month} />}
      {activeTab === 'partners'   && <PartnerInsights  clientId={clientId} month={month} />}
      {activeTab === 'beacon'     && <BeaconSetup      clientId={clientId} />}
    </div>
  )
}