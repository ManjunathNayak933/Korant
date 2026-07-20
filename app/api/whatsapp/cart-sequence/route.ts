// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/cart-sequence/route.ts                        │
// │                                                                            │
// │ GET  → the brand's current sequence config + up to 3 steps.               │
// │ PUT  → save it. Creates a per-step tracking slug (the "3 UTM links"),      │
// │        and, when a step carries a coupon, creates it on Shopify/Razorpay   │
// │        exactly like the campaign create route does.                        │
// │                                                                            │
// │ Scheduling is IST-only (Asia/Kolkata). The timezone is no longer a         │
// │ free-text field — an invalid IANA name used to throw a RangeError inside   │
// │ Intl and take down the intake webhook (and the whole cron run).            │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'
import { createShopifyDiscountCode } from '@/lib/shopify'
import { createRazorpayOffer } from '@/lib/razorpay'
import { findDiscountCodeOwner } from '@/lib/codes'
import { invalidateLink } from '@/lib/links'
import { IST_TIMEZONE, numOr } from '@/lib/cart-abandonment'

export const dynamic = 'force-dynamic'

// Clamp helper that treats 0 as a REAL value. The old code used
// `Number(x) || default`, so delay_days 0 silently became 1, send_hour 0
// (midnight) became 10, and expiry_days 0 became 14 — the user picked a value
// in the UI and a different one was stored, with no feedback.
function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.trunc(numOr(v, def))
  return Math.min(max, Math.max(min, n))
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()

  const [{ data: seq }, { data: steps }] = await Promise.all([
    sb.from('cart_sequences').select('*').eq('client_id', userId).maybeSingle(),
    sb.from('cart_sequence_steps').select('*').eq('client_id', userId).order('step_no', { ascending: true }),
  ])

  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ''
  const withLinks = (steps || []).map(s => ({ ...s, tracking_link: `${base}/r/${s.tracking_slug}` }))

  return NextResponse.json({
    sequence: seq
      ? { ...seq, timezone: IST_TIMEZONE }
      : { enabled: false, send_hour: 10, timezone: IST_TIMEZONE, expiry_days: 14 },
    steps: withLinks,
    timezone: IST_TIMEZONE,
  })
}

export async function PUT(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const { enabled = false, steps = [] } = body as any

  if (!Array.isArray(steps) || steps.length > 3) {
    return NextResponse.json({ error: 'steps must be an array of at most 3' }, { status: 400 })
  }
  // 0 = midnight is now a valid, storable choice.
  const hour = clampInt((body as any).send_hour, 10, 0, 23)
  const expiryDays = clampInt((body as any).expiry_days, 14, 1, 90)

  // An enabled sequence with no enabled step can never send — reject it here
  // rather than letting the brand think it's live.
  if (enabled && !steps.some((s: any) => s && s.enabled !== false && s.template_name)) {
    return NextResponse.json(
      { error: 'Turn on at least one message with an approved template before activating the sequence.' },
      { status: 400 }
    )
  }

  const sb = getSupabaseAdmin()

  // 1) Upsert the per-client sequence config. Timezone is always IST.
  const { data: seq, error: seqErr } = await sb
    .from('cart_sequences')
    .upsert({
      client_id: userId, enabled: !!enabled, send_hour: hour,
      timezone: IST_TIMEZONE, expiry_days: expiryDays,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select().single()
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })

  // Existing steps, so we can reuse slugs (don't churn tracking links on edit).
  const { data: existing } = await sb
    .from('cart_sequence_steps').select('*').eq('client_id', userId)
  const existingByNo: Record<number, any> = {}
  ;(existing || []).forEach(s => { existingByNo[s.step_no] = s })

  // Guard against two steps in the SAME payload claiming one coupon — the
  // cross-asset check below can't see codes that aren't persisted yet.
  const seenCodes = new Set<string>()

  const savedSteps: any[] = []
  const warnings: string[] = []

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const stepNo = i + 1
    if (!s.template_name) {
      return NextResponse.json({ error: `Step ${stepNo}: template is required` }, { status: 400 })
    }

    // Reuse the existing slug for this step number, else mint a new one.
    const slug = existingByNo[stepNo]?.tracking_slug || await ensureUniqueSlug(`wa-cart-s${stepNo}`)

    const code = s.coupon_code ? String(s.coupon_code).trim().toUpperCase() : null
    if (code) {
      if (seenCodes.has(code)) {
        return NextResponse.json(
          { error: `Step ${stepNo}: coupon "${code}" is already used by an earlier message in this sequence. Each code can belong to only one asset.` },
          { status: 409 }
        )
      }
      seenCodes.add(code)
    }

    let priceRuleId: number | null = existingByNo[stepNo]?.shopify_price_rule_id || null
    let offerId: string | null = existingByNo[stepNo]?.razorpay_offer_id || null

    // Only touch discount providers when the code is new or changed for this step.
    const codeChanged = code && code !== (existingByNo[stepNo]?.coupon_code || null)
    if (code && codeChanged) {
      // Guard: refuse a code another asset already owns (shared codes silently
      // lose attribution — see lib/codes.ts). Cart steps are registered owners
      // there now, so this check is finally symmetric: an influencer created
      // later can no longer steal a code a cart step is already using.
      const owner = await findDiscountCodeOwner(userId, code, { table: 'cart_sequence_steps', id: String(stepNo) })
      if (owner) {
        return NextResponse.json(
          { error: `Step ${stepNo}: coupon "${code}" is already used by ${owner.name}. Pick a different code.` },
          { status: 409 }
        )
      }
      const [shop, razor] = await Promise.allSettled([
        createShopifyDiscountCode(userId, code),
        createRazorpayOffer(userId, code),
      ])
      if (shop.status === 'fulfilled' && shop.value) priceRuleId = shop.value.priceRuleId
      else warnings.push(`Step ${stepNo}: coupon saved but Shopify code not created (is Shopify connected?).`)
      if (razor.status === 'fulfilled' && razor.value) offerId = razor.value.offerId
    }

    const { data: saved, error: stepErr } = await sb
      .from('cart_sequence_steps')
      .upsert({
        sequence_id: seq.id,
        client_id: userId,
        step_no: stepNo,
        enabled: s.enabled !== false,
        // 0 = "same day, at the send hour" is now storable.
        delay_days: clampInt(s.delay_days, 1, 0, 30),
        template_id: s.template_id || null,
        template_name: s.template_name,
        language: s.language || 'en',
        variable_map: s.variable_map || {},
        coupon_code: code,
        shopify_price_rule_id: priceRuleId,
        razorpay_offer_id: offerId,
        tracking_slug: slug,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,step_no' })
      .select().single()
    if (stepErr) return NextResponse.json({ error: `Step ${stepNo}: ${stepErr.message}` }, { status: 500 })

    // The /r/[slug] resolver caches step rows (coupon + shop domain) in KV for
    // 10 min. Bust it so an edited coupon takes effect on the next click.
    await invalidateLink(slug)

    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ''
    savedSteps.push({ ...saved, tracking_link: `${base}/r/${saved.tracking_slug}` })
  }

  // Remove any steps the brand dropped (e.g. went from 3 steps down to 2).
  const keep = savedSteps.map(s => s.step_no)
  const dropped = (existing || []).filter(s => !keep.includes(s.step_no))
  if (dropped.length) {
    await sb.from('cart_sequence_steps').delete()
      .eq('client_id', userId).in('step_no', dropped.map(s => s.step_no))
    for (const d of dropped) await invalidateLink(d.tracking_slug)
  }

  return NextResponse.json({ sequence: { ...seq, timezone: IST_TIMEZONE }, steps: savedSteps, warnings })
}
