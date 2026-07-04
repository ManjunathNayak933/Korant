import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'

export const metadata: Metadata = {
  title: 'MicroKorant | Know Your Channel',
  description: 'Track influencer, SEO, and affiliate performance.',
}

export const runtime = 'nodejs'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23131318'/><rect x='6.5' y='6' width='2' height='20' rx='1' fill='%239d99ff'/><path d='M9 16 L20 6.5 M9 16 L20 25.5' stroke='%23eceaf5' stroke-width='2.2' stroke-linecap='round' fill='none'/></svg>" />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
