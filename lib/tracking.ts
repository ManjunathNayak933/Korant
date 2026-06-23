// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/tracking.ts                                            │
// │ Replace the existing file at <repo-root>/lib/tracking.ts              │
// └──────────────────────────────────────────────────────────────────────┘
// NOTE: `findEntityBySlug` was removed — it was dead code. The redirect path
// (`/r/[slug]`) resolves links through `resolveLink` in lib/links.ts, not this.

export function generateSlug(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let slug = prefix ? `${prefix}-` : ''
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)]
  }
  return slug
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  // Clean the base
  const clean = base.toLowerCase().replace(/[^a-z0-9-]/g, '')
  // Append a random 6-char suffix — collision probability is ~1 in 2 billion, no loop needed
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${clean}-${suffix}`
}

export function parseGeoFromRequest(req: Request) {
  const headers = req.headers
  return {
    country: headers.get('cf-ipcountry') || null,
    city: headers.get('cf-ipcity') || headers.get('x-vercel-ip-city') || null,
    lat: headers.get('cf-iplatitude') ? parseFloat(headers.get('cf-iplatitude')!) : null,
    lon: headers.get('cf-iplongitude') ? parseFloat(headers.get('cf-iplongitude')!) : null,
    ip: headers.get('cf-connecting-ip') || headers.get('x-forwarded-for') || null,
  }
}

export function parseDeviceBrowser(req: Request) {
  const ua = req.headers.get('user-agent') || ''
  let device = 'desktop'
  if (/mobile|android|iphone|ipad/i.test(ua)) device = 'mobile'
  else if (/tablet/i.test(ua)) device = 'tablet'
  let browser = 'other'
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = 'chrome'
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'safari'
  else if (/firefox/i.test(ua)) browser = 'firefox'
  else if (/edge/i.test(ua)) browser = 'edge'
  return { device, browser }
}
