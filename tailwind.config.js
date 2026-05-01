/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0d0d0d',
        surface: '#111111',
        border: '#1e1e1e',
        amber: '#d4a843',
        green: '#2ecc71',
        blue: '#4a9eff',
        red: '#e74c3c',
        muted: '#5a5652',
        dim: '#3a3632',
        text: {
          primary: '#e8e4dc',
          secondary: '#c8c4bc',
          muted: '#7a7670',
          dim: '#4a4642',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'Helvetica Neue', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderWidth: { DEFAULT: '0.5px' },
      fontSize: {
        '2xs': ['10px', { letterSpacing: '0.5px' }],
        xs: ['11px', {}],
        sm: ['12px', {}],
        base: ['13px', {}],
        md: ['14px', {}],
      },
    },
  },
  plugins: [],
}
