'use client'

interface Campaign { id: string; name: string }
interface Props {
  campaigns: Campaign[]
  selected: string
  onChange: (id: string) => void
  onAdd?: () => void
}

export default function CampaignFilter({ campaigns, selected, onChange, onAdd }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', marginRight: 4 }}>Campaign:</span>
      <button
        onClick={() => onChange('')}
        style={{ padding: '4px 12px', borderRadius: 6, border: `0.5px solid ${!selected ? 'var(--amber)' : 'var(--border2)'}`, background: 'transparent', color: !selected ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
      >
        All
      </button>
      {campaigns.map(c => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          style={{ padding: '4px 12px', borderRadius: 6, border: `0.5px solid ${selected === c.id ? 'var(--amber)' : 'var(--border2)'}`, background: 'transparent', color: selected === c.id ? 'var(--amber)' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
        >
          {c.name}
        </button>
      ))}
      {onAdd && (
        <button
          onClick={onAdd}
          style={{ padding: '4px 10px', borderRadius: 6, border: '0.5px dashed var(--border2)', background: 'transparent', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer' }}
        >
          + New
        </button>
      )}
    </div>
  )
}
