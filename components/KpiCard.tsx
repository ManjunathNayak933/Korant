interface Props {
  label: string
  value: string | number
  delta?: string
  deltaType?: 'up' | 'down' | 'info' | 'muted'
}
const DELTA_COLOR = { up: '#2ecc71', down: '#e74c3c', info: '#4a9eff', muted: '#3a3632' }

export default function KpiCard({ label, value, delta, deltaType = 'muted' }: Props) {
  return (
    <div style={{ padding: '18px 22px', borderRight: '0.5px solid #1e1e1e' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.5px', color: '#4a4642', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, color: '#e8e4dc', lineHeight: 1 }}>{value}</div>
      {delta && (
        <div style={{ marginTop: 5, fontSize: 11, color: DELTA_COLOR[deltaType] }}>{delta}</div>
      )}
    </div>
  )
}
