'use client'

interface Point { label: string; value: number }
interface Props { title: string; points: Point[]; color?: string; emptyMessage?: string }

export default function MiniLineChart({ title, points, color = 'var(--amber)', emptyMessage = 'No data yet' }: Props) {
  const hasData = points.some(p => p.value > 0)
  const max = Math.max(...points.map(p => p.value), 1)
  const W = 300, H = 70

  const toX = (i: number) => (i / Math.max(points.length - 1, 1)) * W
  const toY = (v: number) => H - (v / max) * (H - 8) - 4

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.value)}`).join(' ')
  const areaD = points.length > 0
    ? `${pathD} L ${toX(points.length - 1)} ${H} L 0 ${H} Z`
    : ''

  return (
    <div className="chart-container">
      <div className="chart-title">{title}</div>
      {!hasData ? (
        <div style={{ height: H + 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <path d={`M 0 ${H*0.6} Q ${W*0.25} ${H*0.4} ${W*0.5} ${H*0.5} Q ${W*0.75} ${H*0.6} ${W} ${H*0.3}`}
              stroke="var(--border2)" strokeWidth="1.5" fill="none" opacity="0.5" />
          </svg>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{emptyMessage}</div>
        </div>
      ) : (
        <div>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaD} fill="url(#lg)" />
            <path d={pathD} stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            {points.map((p, i) => p.value > 0 && (
              <circle key={i} cx={toX(i)} cy={toY(p.value)} r="2.5" fill={color} />
            ))}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            {points.map((p, i) => (
              <div key={i} style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>{p.label}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
