// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/clients/integrations/route.ts                          │
// │ Replace the existing file at                                               │
// │   <repo-root>/app/api/clients/integrations/route.ts                        │
// │                                                                            │
// │ Generates a per-client webhook key on first call (race-safe) and returns a │
// │ ready-to-paste webhook URL (cid + key baked in) plus token status, so the  │
// │ setup screen needs zero fields for sale tracking.                          │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// 48 hex chars (24 random bytes) — unguessable, URL-safe, not printed anywhere
// public (unlike the clientId, which is in the storefront beacon snippet).
function generateKey(): string {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()

  const { data } = await sb
    .from('clients')
    .select('shopify_domain, shopify_token, webhook_secret, razorpay_key_id, razorpay_key_secret')
    .eq('id', userId)
    .single()

  // Ensure a per-client webhook key exists. Race-safe: the update only writes
  // when webhook_secret is still null, so concurrent first-loads can't clobber
  // each other — we re-read to return whichever value actually persisted. The
  // key now lives in the webhook URL (?k=), so it IS returned to the owner.
  let key = data?.webhook_secret || ''
  if (!key) {
    const newKey = generateKey()
    await sb.from('clients').update({ webhook_secret: newKey }).eq('id', userId).is('webhook_secret', null)
    const { data: fresh } = await sb.from('clients').select('webhook_secret').eq('id', userId).single()
    key = fresh?.webhook_secret || newKey
  }

  return NextResponse.json(buildPayload(userId, key, data))
}

// Shared response shape for GET and POST (rotation).
function buildPayload(
  userId: string,
  key: string,
  data: { shopify_domain?: string | null; shopify_token?: string | null; razorpay_key_id?: string | null; razorpay_key_secret?: string | null } | null,
) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.microkorant.in'
  return {
    // Existing flags — kept for backward compatibility (CouponStatusHint, etc.).
    // `shopify` = discount automation ready (domain + token).
    shopify: !!(data?.shopify_domain && data?.shopify_token),
    razorpay: !!(data?.razorpay_key_id && data?.razorpay_key_secret),

    // The ready-to-paste webhook URL — the only thing the customer needs for
    // sale tracking (zero fields).
    webhook_url: `${base}/api/webhook/shopify?cid=${userId}&k=${key}`,

    // Third-party / custom checkout (any non-native Shopify checkout). Their
    // platform POSTs completed orders + refunds here; clientId is in the URL and
    // the SAME secret goes in the `x-webhook-secret` HEADER — kept out of the URL
    // so it can't leak into access logs / history / Referer the way ?k= can.
    generic_webhook_url: `${base}/api/webhook/generic?clientId=${userId}`,
    webhook_secret: key,

    // Optional auto-codes status. Domain is auto-captured from the first order;
    // token is exposed only as a boolean, never its value.
    has_shopify_token: !!data?.shopify_token,
    has_shopify_domain: !!data?.shopify_domain,
    shopify_domain: data?.shopify_domain || '',
  }
}

// Rotate the webhook secret. Overwrites clients.webhook_secret and returns the
// fresh URLs. NOTE: this invalidates the previous secret for BOTH the generic
// endpoint AND the Shopify ?k= URL, so both must be re-copied after rotating.
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()

  const newKey = generateKey()
  await sb.from('clients').update({ webhook_secret: newKey }).eq('id', userId)

  const { data } = await sb
    .from('clients')
    .select('shopify_domain, shopify_token, razorpay_key_id, razorpay_key_secret')
    .eq('id', userId)
    .single()

  return NextResponse.json(buildPayload(userId, newKey, data))
}
