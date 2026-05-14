'use client'
import RetentionPanel  from './RetentionPanel'
import JourneyExplorer from './JourneyExplorer'
import { useState }    from 'react'

interface Props { clientId?: string; month?: string }

// Beacon / tracking setup is in the Setup wizard (Setup button in nav bar).
const TABS = [
  { id: 'retention', label: '↩️ Retention',       desc: 'Who came back, when, and from which channel' },
  { id: 'journey',   label: '🗺️ Journey Explorer', desc: 'Cross-channel paths, attribution models, channel assist' },
]

export default function AnalyticsDashboard({ clientId, month }: Props) {
  const [activeTab, setActiveTab] = useState('retention')
  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: 24 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 18px', fontSize: 12, border: 'none', whiteSpace: 'nowrap',
            borderBottom: `2px solid ${activeTab === tab.id ? 'var(--amber)' : 'transparent'}`,
            background: 'transparent',
            color: activeTab === tab.id ? 'var(--amber)' : 'var(--text-muted)',
            cursor: 'pointer', fontWeight: activeTab === tab.id ? 500 : 400,
          }}>{tab.label}</button>
        ))}
      </div>
      <div style={{ marginBottom: 20, fontSize: 12, color: 'var(--text-dim)' }}>
        {TABS.find(t => t.id === activeTab)?.desc}
      </div>
      {activeTab === 'retention' && <RetentionPanel  clientId={clientId} month={month} />}
      {activeTab === 'journey'   && <JourneyExplorer clientId={clientId} month={month} />}
    </div>
  )
}