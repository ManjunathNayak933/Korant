// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/shopify/install/route.ts   (NEW FILE)                   │
// │ Create at <repo-root>/app/api/shopify/install/route.ts                     │
// │                                                                            │
// │ Starts the Shopify "Connect" OAuth flow. The logged-in client hits this    │
// │ with ?shop=<their store>; we redirect them to Shopify's consent screen.    │
// │ State is a stateless signed token tying the round-trip to this client +    │
// │ shop, verified in the callback. Requires env: SHOPIFY_API_KEY,             │
// │ SHOPIFY_API_SECRET, NEXT_PUBLIC_BASE_URL.                                   │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

// Scopes: discount-code management (create/update/delete/look up) + read_orders
// for sales, and read_checkouts so the app can subscribe to the CHECKOUTS_*
// webhooks that power cart abandonment. Keep this minimal — Shopify restricts
// unused scopes. NOTE: checkout/customer data is "protected customer data" —
// the app must also be approved for it in the Shopify Partner dashboard.
const SCOPES = 'read_orders,read_checkouts,write_discounts,read_discounts'

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Accepts "store", "store.myshopify.com", or "https://store.myshopify.com/…"
// and returns the canonical "store.myshopify.com", or null if invalid.
function normalizeShop(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (s && !s.includes('.')) s = `${s}.myshopify.com`
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null
}

export async function GET(request: NextRequest) {
  const clientId = request.headers.get('x-user-id')
  if (!clientId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const shop = normalizeShop(new URL(request.url).searchParams.get('shop') || '')
  if (!shop) {
    return NextResponse.json({ error: 'Enter a valid yourstore.myshopify.com address' }, { status: 400 })
  }

  const apiKey = process.env.SHOPIFY_API_KEY
  const secret = process.env.SHOPIFY_API_SECRET
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.microkorant.in'
  if (!apiKey || !secret) {
    return NextResponse.json({ error: 'Shopify app not configured on the server' }, { status: 500 })
  }

  // Stateless signed state: clientId:shop:timestamp:nonce + HMAC. Verified in
  // the callback so the token is stored against the right client, and replays
  // older than 10 minutes are rejected. No DB row / cookie needed.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const payload = `${clientId}:${shop}:${Date.now()}:${nonce}`
  const state = `${b64url(payload)}.${await hmacHex(payload, secret)}`

  const redirectUri = `${base}/api/shopify/callback`
  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(apiKey)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`

  return NextResponse.redirect(authorizeUrl, 302)
}
