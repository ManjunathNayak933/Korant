// Razorpay discount handling.
//
// IMPORTANT: Razorpay does NOT expose a public API to *create* Offers. Per
// Razorpay's docs, Offers can only be created from the Dashboard and are then
// referenced by `offer_id` at order/checkout time. The previous implementation
// POSTed to `/v1/offers`, which is not a real endpoint and always failed
// (silently swallowed by the callers' Promise.allSettled), so no Razorpay
// discount was ever actually created.
//
// Korant's attribution does not depend on a Razorpay-side Offer existing: the
// discount code is generated locally and travels to the webhook via the order
// `notes` (mk_slug / discount_code), which `webhook/razorpay` already reads.
// We therefore keep the discount code on our side and do not attempt a
// non-existent create call. The functions below preserve the existing
// interface for callers but no longer hit a phantom endpoint.
//
// If a merchant wants the code to also be a real Razorpay Dashboard Offer,
// they create it in the Razorpay Dashboard and we can store its offer_id; a
// future `linkRazorpayOffer(clientId, offerId)` can attach it to orders.

import { getSupabaseAdmin } from './supabase'

async function razorpayFetch(keyId: string, keySecret: string, path: string, method = 'GET', body?: unknown) {
  const auth = btoa(`${keyId}:${keySecret}`)
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Razorpay ${method} ${path} failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Reads per-client Razorpay credentials from the `clients` table
// (razorpay_key_id / razorpay_key_secret), falling back to global env vars
// for single-tenant / testing setups.
export async function getClientRazorpay(
  clientId: string
): Promise<{ keyId: string; keySecret: string } | null> {
  try {
    const sb = getSupabaseAdmin()
    const { data } = await sb
      .from('clients')
      .select('razorpay_key_id, razorpay_key_secret')
      .eq('id', clientId)
      .single()
    if (data?.razorpay_key_id && data?.razorpay_key_secret) {
      return { keyId: data.razorpay_key_id, keySecret: data.razorpay_key_secret }
    }
  } catch { /* fall through to env */ }

  const keyId = (globalThis as any).process?.env?.RAZORPAY_KEY_ID
  const keySecret = (globalThis as any).process?.env?.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return null
  return { keyId, keySecret }
}

// No-op create: Razorpay has no public Offer-create endpoint. We keep the
// discount code on our side (already stored on the influencer/affiliate row)
// and rely on order `notes` for attribution. Returns null so callers simply
// don't set a razorpay_offer_id — which is correct, since none exists.
export async function createRazorpayOffer(
  _clientId: string,
  _couponCode: string,
  _discountPercent: number = 10,
  _description?: string
): Promise<{ offerId: string } | null> {
  return null
}

// Only meaningful for an offer_id that was created in the Razorpay Dashboard
// and stored on our side. Safe no-op when no real offer exists.
export async function deleteRazorpayOffer(offerId: string, clientId: string): Promise<void> {
  if (!offerId) return
  const creds = await getClientRazorpay(clientId)
  if (!creds) return
  try {
    await razorpayFetch(creds.keyId, creds.keySecret, `/offers/${offerId}`, 'DELETE')
  } catch (e) {
    console.error('Razorpay offer deletion failed:', e)
  }
}
