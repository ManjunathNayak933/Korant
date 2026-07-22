// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/baseUrl.ts                                                 │
// │                                                                            │
// │ ONE resolver for the app's public origin. Everything that hands a URL to  │
// │ an external system — the Shopify OAuth callback (which registers order +   │
// │ checkout webhooks), the third-party integrations panel, and the cart tick  │
// │ — must agree on this value, or Shopify silently posts to the wrong host.   │
// │                                                                            │
// │ Order of precedence:                                                       │
// │   1. BASE_URL             — runtime env, settable WITHOUT a rebuild.       │
// │   2. NEXT_PUBLIC_BASE_URL  — inlined at BUILD time.                        │
// │   3. hard-coded default.                                                    │
// │                                                                            │
// │ The old code used only (2)+(3) in the Shopify callback, so setting (1) at  │
// │ runtime didn't fix a misregistered webhook. Preferring (1) here means a    │
// │ runtime BASE_URL is authoritative everywhere.                              │
// └──────────────────────────────────────────────────────────────────────────┘

export const FALLBACK_BASE_URL = 'https://www.microkorant.in'

/** Resolved public origin, no trailing slash. Never empty. */
export function getBaseUrl(): string {
  const raw =
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    FALLBACK_BASE_URL
  return raw.replace(/\/+$/, '')
}

/** True only if an explicit BASE_URL / NEXT_PUBLIC_BASE_URL was provided. */
export function baseUrlIsExplicit(): boolean {
  return !!(process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL)
}

/**
 * Host that a request actually arrived on (honours the edge proxy headers).
 * Used by the admin health check to catch the case where the configured base
 * URL doesn't match the origin the app is really being served from.
 */
export function originFromRequest(req: Request): string | null {
  try {
    const xfHost = req.headers.get('x-forwarded-host')
    const host = xfHost || req.headers.get('host')
    if (!host) return null
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${host}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}
