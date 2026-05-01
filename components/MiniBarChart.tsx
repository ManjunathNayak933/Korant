'use client'

interface Bar { label: string; value: number; color?: string }
interface Props {
  title: string
  bars: Bar[]
  emptyMessage?: string
  height?: number
}

export default function MiniBarChart({ title, bars, emptyMessage = 'No data yet', height = 80 }: Props) {
  const max = Math.max(...bars.map(b => b.value), 1)
  const hasData = bars.some(b => b.value > 0)

  return (
    <div className="chart-container">
      <div className="chart-title">{title}</div>
      {!hasData ? (
        <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {/* Empty bar skeleton */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height * 0.6 }}>
            {[40, 70, 55, 85, 45, 60, 30].map((h, i) => (
              <div key={i} style={{ width: 16, height: `${h}%`, background: 'var(--border2)', borderRadius: '3px 3px 0 0', opacity: 0.4 }} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{emptyMessage}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
          {bars.map((bar, i) => {
            const pct = (bar.value / max) * 100
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{bar.value > 999 ? `${(bar.value/1000).toFixed(1)}k` : bar.value}</div>
                <div style={{ width: '100%', height: `${Math.max(pct, 4)}%`, background: bar.color || 'var(--amber)', borderRadius: '3px 3px 0 0', transition: 'height 0.4s', minHeight: 3 }} />
                <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.2 }}>{bar.label}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
