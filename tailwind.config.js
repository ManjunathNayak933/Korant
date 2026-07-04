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
        bg: '#131318',
        surface: '#1a1a22',
        border: '#26262f',
        amber: '#9d99ff',   // primary — periwinkle iris (name kept for compatibility)
        iris: '#9d99ff',
        spark: '#f0a868',   // warm apricot accent
        green: '#4fc48a',
        blue: '#5bb0e6',
        red: '#f2617a',
        muted: '#6e6c79',
        dim: '#3e3c47',
        text: {
          primary: '#eceaf5',
          secondary: '#c2c0d0',
          muted: '#84828f',
          dim: '#56545f',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SF Mono', 'ui-monospace', 'monospace'],
      },
      borderWidth: { DEFAULT: '1px' },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.22)',
        lift: '0 8px 30px rgba(0,0,0,.45)',
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      fontSize: {
        '2xs': ['11px', { letterSpacing: '0' }],
        xs: ['12px', {}],
        sm: ['13px', {}],
        base: ['14px', {}],
        md: ['15px', {}],
      },
    },
  },
  plugins: [],
}
