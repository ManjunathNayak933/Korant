// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/shopify/callback/route.ts   (NEW FILE)                  │
// │ Create at <repo-root>/app/api/shopify/callback/route.ts                    │
// │                                                                            │
// │ Shopify redirects here after the merchant approves. We verify Shopify's    │
// │ HMAC and our signed state, exchange the code for an Admin API token, and   │
// │ store shopify_token + shopify_domain on the client. From then on           │
// │ lib/shopify.ts can create discount codes for that store.                   │
// │                                                                            │
// │ IMPORTANT: add this exact URL to the app's allowed redirect URLs in the    │
// │ Shopify Dev Dashboard:  <NEXT_PUBLIC_BASE_URL>/api/shopify/callback         │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { registerShopifyOrderWebhooks } from '@/lib/shopify'

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return atob(s)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const params = url.searchParams
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.microkorant.in'
  const apiKey = process.env.SHOPIFY_API_KEY
  const secret = process.env.SHOPIFY_API_SECRET

  const fail = (reason: string) => NextResponse.redirect(`${base}/?shopify=${reason}`, 302)

  if (!apiKey || !secret) return fail('error')

  const shop = params.get('shop') || ''
  const code = params.get('code') || ''
  const state = params.get('state') || ''
  const hmac = params.get('hmac') || ''

  // 1. shop must be a real myshopify domain (guards the token POST against SSRF)
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return fail('error')
  if (!code || !state || !hmac) return fail('error')

  // 2. Verify Shopify's HMAC over the RAW query (minus hmac/signature), sorted.
  //    Use the raw query string so encoded values match exactly what Shopify
  //    signed (don't decode via searchParams).
  const rawPairs = url.search.slice(1).split('&')
    .filter(p => p && !p.startsWith('hmac=') && !p.startsWith('signature='))
    .sort()
  const computedHmac = await hmacHex(rawPairs.join('&'), secret)
  if (!timingSafeEqual(computedHmac, hmac)) return fail('error')

  // 3. Verify our signed state and pull out the clientId + shop + timestamp.
  const dot = state.lastIndexOf('.')
  if (dot < 0) return fail('error')
  const payloadB64 = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  let payload: string
  try { payload = b64urlDecode(payloadB64) } catch { return fail('error') }
  const expectedSig = await hmacHex(payload, secret)
  if (!timingSafeEqual(expectedSig, sig)) return fail('error')

  const [clientId, stateShop, tsStr] = payload.split(':')
  if (!clientId || stateShop !== shop) return fail('error')
  if (Date.now() - parseInt(tsStr || '0', 10) > 10 * 60 * 1000) return fail('expired')

  // 4. Exchange the authorization code for a permanent Admin API access token.
  let accessToken = ''
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: secret, code }),
    })
    if (!tokenRes.ok) return fail('error')
    const data = await tokenRes.json() as { access_token?: string }
    accessToken = data.access_token || ''
  } catch {
    return fail('error')
  }
  if (!accessToken) return fail('error')

  // 5. Store the token + domain on this client. lib/shopify.ts uses both to
  //    create discount codes via the Admin API.
  const sb = getSupabaseAdmin()
  const { error } = await sb
    .from('clients')
    .update({ shopify_token: accessToken, shopify_domain: shop, updated_at: new Date().toISOString() })
    .eq('id', clientId)
  if (error) return fail('error')

  // 6. Subscribe the app to order webhooks so SALES flow in too — no manual
  //    webhook step for the customer. Signed with our app secret; the handler
  //    finds the client by shop domain (stored just above). Best-effort: a
  //    failure here doesn't undo the connection (codes still work).
  await registerShopifyOrderWebhooks(shop, accessToken, `${base}/api/webhook/shopify`)

  return NextResponse.redirect(`${base}/?shopify=connected`, 302)
}
