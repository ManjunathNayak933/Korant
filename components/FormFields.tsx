interface Props {
  label: string
  required?: boolean
  children: React.ReactNode
  hint?: string
}

export function FormField({ label, required, children, hint }: Props) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, color: '#5a5652', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#e74c3c', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: '#3a3632', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { options: { value: string; label: string }[] }
export function Select({ options, ...props }: SelectProps) {
  return (
    <select {...props} style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none', ...props.style }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none', ...props.style }} />
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 7, color: '#e8e4dc', fontSize: 13, fontFamily: 'inherit', padding: '8px 12px', width: '100%', outline: 'none', resize: 'vertical', minHeight: 80, ...props.style }} />
  )
}

interface SubmitProps { loading?: boolean; label?: string; loadingLabel?: string; color?: 'amber' | 'green' | 'red' }
const COLORS = { amber: '#d4a843', green: '#2ecc71', red: '#e74c3c' }
export function SubmitButton({ loading, label = 'Save', loadingLabel = 'Saving…', color = 'amber' }: SubmitProps) {
  const c = COLORS[color]
  return (
    <button type="submit" disabled={loading} style={{ background: 'transparent', border: `0.5px solid ${c}`, color: c, borderRadius: 7, padding: '8px 18px', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 7 }}>
      {loading && <span style={{ width: 12, height: 12, border: `1.5px solid ${c}40`, borderTopColor: c, borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />}
      {loading ? loadingLabel : label}
    </button>
  )
}
