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
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%230d0d0d'/><text x='16' y='23' font-family='sans-serif' font-size='20' font-weight='500' fill='%23d4a843' text-anchor='middle'>K</text></svg>"/>
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
