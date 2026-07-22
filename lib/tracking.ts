// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/tracking.ts                                            │
// │ Replace the existing file at <repo-root>/lib/tracking.ts              │
// └──────────────────────────────────────────────────────────────────────┘
// NOTE: `findEntityBySlug` was removed — it was dead code. The redirect path
// (`/r/[slug]`) resolves links through `resolveLink` in lib/links.ts, not this.

import { getSupabaseAdmin } from './supabase'

export function generateSlug(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let slug = prefix ? `${prefix}-` : ''
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)]
  }
  return slug
}

// Fixed-length, uniformly-distributed suffix. crypto.getRandomValues is
// available in both the edge runtime and Node 18+. The previous
// `Math.random().toString(36).slice(2,8)` could return FEWER than 6 chars when
// the random float was small, and never checked the DB despite the name —
// `redirect_slug` / `tracking_slug` are UNIQUE, so a collision surfaced to the
// user as a save failure.
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
function randomSuffix(len = 8): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length]
  return out
}

// Every table whose slug column feeds resolveLink() shares ONE namespace — a
// slug must be unique across all of them, or two links collide in the resolver.
async function slugTaken(slug: string): Promise<boolean> {
  const sb = getSupabaseAdmin()
  const checks = await Promise.all([
    sb.from('influencers').select('id', { head: true, count: 'exact' }).eq('redirect_slug', slug),
    sb.from('affiliates').select('id', { head: true, count: 'exact' }).eq('redirect_slug', slug),
    sb.from('publications').select('id', { head: true, count: 'exact' }).eq('redirect_slug', slug),
    sb.from('whatsapp_campaigns').select('id', { head: true, count: 'exact' }).eq('tracking_slug', slug),
    sb.from('cart_sequence_steps').select('id', { head: true, count: 'exact' }).eq('tracking_slug', slug),
  ])
  // A missing table/column (older deployments) returns an error, not a row —
  // treat that as "not taken here" rather than blocking slug creation.
  return checks.some(c => (c.count || 0) > 0)
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  const clean = (base || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'lnk'

  // Try a few times; with an 8-char suffix over 36 symbols the first attempt
  // essentially always wins, but the DB check makes it correct rather than
  // probabilistic. Widen the suffix on the (vanishing) chance of repeated hits.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${clean}-${randomSuffix(attempt < 3 ? 8 : 12)}`
    try {
      if (!(await slugTaken(candidate))) return candidate
    } catch {
      // Uniqueness check itself failed (network/DB) — fall back to the
      // candidate; the UNIQUE constraint is the final backstop.
      return candidate
    }
  }
  // Exhausted retries (astronomically unlikely): timestamp guarantees length.
  return `${clean}-${randomSuffix(8)}${Date.now().toString(36)}`
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
