// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/affiliate-signup/[clientSlug]/route.ts
// │ Replace the existing file at <repo-root>/app/api/affiliate-signup/[clientSlug]/route.ts
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'
import { createShopifyDiscountCode } from '@/lib/shopify'
import { createRazorpayOffer } from '@/lib/razorpay'
import { cacheGet, cacheSet } from '@/lib/cache'

// Lightweight fixed-window rate limit on Cloudflare KV. Returns false when the
// caller is over budget. (A captcha + email verification is the proper next step
// for a fully open endpoint, but this stops trivial mass-signup abuse.)
async function underLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const n = (await cacheGet<number>(key)) || 0
  if (n >= limit) return false
  await cacheSet(key, n + 1, windowSec)
  return true
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Look up a client by their public affiliate slug.
async function getClientBySlug(clientSlug: string) {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('clients')
    .select('id, name, custom_domain, shopify_domain')
    .eq('affiliate_slug', clientSlug)
    .single()
  return data
}

// All active, public programs for a client (newest first).
async function getPublicPrograms(clientId: string) {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('affiliate_programs')
    .select('id, name, description, commission_type, commission_value, commission_trigger, attribution_window_days')
    .eq('client_id', clientId)
    .eq('is_public', true)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  return data || []
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const programId = new URL(request.url).searchParams.get('program')

  const client = await getClientBySlug(clientSlug)
  if (!client) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  const allPrograms = await getPublicPrograms(client.id)
  // Pick the requested program if valid, otherwise default to the newest.
  const program = programId
    ? allPrograms.find((p: any) => p.id === programId) || null
    : allPrograms[0] || null

  if (!program) return NextResponse.json({ error: 'No active public program' }, { status: 404 })

  return NextResponse.json({ client: { name: client.name }, program, allPrograms })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const body = await request.json()

  const { name, email, handle } = body
  if (!name || !email || !handle) {
    return NextResponse.json({ error: 'name, email, handle required' }, { status: 400 })
  }
  // Basic input hardening for an unauthenticated, public endpoint.
  if (!EMAIL_RE.test(String(email)) || String(name).length > 120 || String(handle).length > 80) {
    return NextResponse.json({ error: 'Invalid name, email, or handle' }, { status: 400 })
  }

  // Rate limit: per IP (5/hour) and per brand slug (50/hour) to curb mass signup.
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown'
  const [ipOk, slugOk] = await Promise.all([
    underLimit(`affsignup:ip:${ip}`, 5, 3600),
    underLimit(`affsignup:slug:${clientSlug}`, 50, 3600),
  ])
  if (!ipOk || !slugOk) {
    return NextResponse.json({ error: 'Too many signups right now. Please try again later.' }, { status: 429 })
  }

  const client = await getClientBySlug(clientSlug)
  if (!client) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  // Resolve the target program: a specific one if requested+valid, else the newest public one.
  const allPrograms = await getPublicPrograms(client.id)
  const program = body.program_id
    ? allPrograms.find((p: any) => p.id === body.program_id) || null
    : allPrograms[0] || null

  if (!program) return NextResponse.json({ error: 'No active public program' }, { status: 404 })

  const sb = getSupabaseAdmin()

  // Idempotent — if this email already joined this program, return their existing details.
  const { data: existing } = await sb
    .from('affiliates')
    .select('id, name, redirect_slug, discount_code')
    .eq('email', email.toLowerCase())
    .eq('program_id', program.id)
    .maybeSingle()

  if (existing) {
    const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${existing.redirect_slug}`
    return NextResponse.json({
      welcome_back: true,
      name: existing.name,
      tracking_link: trackingLink,
      discount_code: existing.discount_code,
    })
  }

  // New signup — fall back to the client's own storefront, never a hardcoded domain.
  // `clients` has no destination_url column; the client's site is custom_domain
  // (preferred) or shopify_domain. Normalise to an absolute URL; '/' as last resort
  // so the NOT NULL affiliates.destination_url is always satisfied.
  const toUrl = (d?: string | null) => (d ? (/^https?:\/\//.test(d) ? d : `https://${d}`) : null)
  const clientHome = toUrl(client.custom_domain) || toUrl(client.shopify_domain) || '/'
  const slugBase = handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const redirect_slug = await ensureUniqueSlug(`aff-${slugBase}`)
  const randomSuffix = Math.floor(Math.random() * 90 + 10)
  const discount_code = `${slugBase.toUpperCase().slice(0, 8)}${randomSuffix}`

  const { data: affiliate, error } = await sb
    .from('affiliates')
    .insert({
      client_id: client.id,
      program_id: program.id,
      source: 'public_signup',
      name,
      handle,
      email: email.toLowerCase(),
      phone: body.phone || null,
      redirect_slug,
      destination_url: body.destination_url || clientHome,
      discount_code,
      commission_type: program.commission_type,
      commission_value: program.commission_value,
      commission_trigger: program.commission_trigger,
      attribution_window_days: program.attribution_window_days,
      created_by: 'public',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // BUG FIX: actually create the discount code on Shopify/Razorpay, like the
  // authenticated add path does. Without this the ambassador was shown a code
  // that did not exist on the store, so customers got "invalid discount code".
  if (discount_code) {
    try {
      const [shopifyResult, razorpayResult] = await Promise.allSettled([
        createShopifyDiscountCode(client.id, discount_code),
        createRazorpayOffer(client.id, discount_code),
      ])
      const updates: Record<string, unknown> = {}
      if (shopifyResult.status === 'fulfilled' && shopifyResult.value) updates.shopify_price_rule_id = shopifyResult.value.priceRuleId
      if (razorpayResult.status === 'fulfilled' && razorpayResult.value) updates.razorpay_offer_id = razorpayResult.value.offerId
      if (Object.keys(updates).length > 0) await sb.from('affiliates').update(updates).eq('id', affiliate.id)
    } catch {}
  }

  const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${redirect_slug}`
  return NextResponse.json({ welcome_back: false, name, tracking_link: trackingLink, discount_code, affiliate_id: affiliate.id }, { status: 201 })
}
