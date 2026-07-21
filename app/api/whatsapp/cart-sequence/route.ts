// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/cart-sequence/route.ts                        │
// │                                                                            │
// │ GET  → the brand's current sequence config + up to 3 steps.               │
// │ PUT  → save it. Creates a per-step tracking slug (the "3 UTM links"),      │
// │        and, when a step carries a coupon, creates it on Shopify/Razorpay   │
// │        exactly like the campaign create route does.                        │
// │                                                                            │
// │ Scheduling is IST-only (Asia/Kolkata).                                     │
// │                                                                            │
// │ ── Fixes in this revision ────────────────────────────────────────────────│
// │ B1  The step write used                                                    │
// │       .upsert(row, { onConflict: 'client_id,step_no' })                    │
// │     but no unique index on (client_id, step_no) exists, and Postgres       │
// │     validates the conflict target at PLAN time — so EVERY save returned    │
// │     500 "there is no unique or exclusion constraint matching the ON        │
// │     CONFLICT specification", including the very first one. Worse, the      │
// │     cart_sequences upsert above it had already succeeded, leaving the      │
// │     brand with `enabled = true` and zero steps: the tick then found        │
// │     nothing to send and reported a healthy `{ok: true, sent: 0}`.          │
// │     Steps are now written explicitly (delete + single batch insert), so    │
// │     this route works with or without the new index — and everything that   │
// │     can fail (coupon ownership, provider calls) is validated BEFORE the    │
// │     existing rows are touched.                                             │
// │ M8  Steps were matched to their saved row POSITIONALLY. Deleting message   │
// │     1 made message 2 become step 1 and inherit step 1's tracking_slug —    │
// │     so links already sitting in customers' WhatsApp silently started       │
// │     resolving to a different message's coupon. Steps now carry their row   │
// │     `id`, so a slug follows the message it belongs to, and reordering no   │
// │     longer collides on (client_id, step_no).                               │
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
    // Surfaced so the tab can warn instead of shipping a relative link.
    base_url_configured: /^https?:\/\//i.test(base),
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
  const nowIso = new Date().toISOString()

  // ── 1) Per-client sequence config. `client_id` IS unique on this table, so
  //       the upsert is valid; fall back to update/insert if that ever changes.
  let seq: any = null
  {
    const up = await sb.from('cart_sequences').upsert({
      client_id: userId, enabled: !!enabled, send_hour: hour,
      timezone: IST_TIMEZONE, expiry_days: expiryDays, updated_at: nowIso,
    }, { onConflict: 'client_id' }).select().single()

    if (!up.error) {
      seq = up.data
    } else if ((up.error as any).code === '42P10') {
      const { data: existingSeq } = await sb
        .from('cart_sequences').select('id').eq('client_id', userId).maybeSingle()
      const res = existingSeq
        ? await sb.from('cart_sequences').update({
            enabled: !!enabled, send_hour: hour, timezone: IST_TIMEZONE,
            expiry_days: expiryDays, updated_at: nowIso,
          }).eq('id', existingSeq.id).select().single()
        : await sb.from('cart_sequences').insert({
            client_id: userId, enabled: !!enabled, send_hour: hour,
            timezone: IST_TIMEZONE, expiry_days: expiryDays, updated_at: nowIso,
          }).select().single()
      if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
      seq = res.data
    } else {
      return NextResponse.json({ error: up.error.message }, { status: 500 })
    }
  }

  // ── 2) Existing steps, so we can reuse slugs (don't churn tracking links on
  //       edit) and avoid re-creating discount codes that haven't changed.
  const { data: existingRows } = await sb
    .from('cart_sequence_steps').select('*').eq('client_id', userId)
  const existing = existingRows || []
  const existingById: Record<string, any> = {}
  const existingByNo: Record<number, any> = {}
  existing.forEach(s => { existingById[s.id] = s; existingByNo[s.step_no] = s })

  // Guard against two steps in the SAME payload claiming one coupon — the
  // cross-asset check below can't see codes that aren't persisted yet.
  const seenCodes = new Set<string>()
  const warnings: string[] = []

  // ── 3) Build every row FIRST. Nothing existing is touched until the whole
  //       payload has passed validation, so a rejected coupon on message 3
  //       can't leave the brand with a half-saved sequence.
  const rows: any[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const stepNo = i + 1
    if (!s.template_name) {
      return NextResponse.json({ error: `Step ${stepNo}: template is required` }, { status: 400 })
    }

    // M8: identity follows the ROW, not the position. `id` comes back from GET
    // and is echoed by the tab; positional matching is the legacy fallback.
    const prior = (s.id && existingById[s.id]) || (!s.id ? existingByNo[stepNo] : null) || null

    const slug = prior?.tracking_slug || await ensureUniqueSlug(`wa-cart-s${stepNo}`)

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

    let priceRuleId: number | null = prior?.shopify_price_rule_id || null
    let offerId: string | null = prior?.razorpay_offer_id || null

    // Only touch discount providers when the code is new or changed for this step.
    const codeChanged = !!code && code !== (prior?.coupon_code || null)
    if (code && codeChanged) {
      // Guard: refuse a code another asset already owns (shared codes silently
      // lose attribution — see lib/codes.ts). Cart steps are registered owners
      // there, so the check is symmetric: an influencer created later can no
      // longer steal a code a cart step is already using.
      const owner = await findDiscountCodeOwner(userId, code, { table: 'cart_sequence_steps', id: String(prior?.step_no ?? stepNo) })
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
    // A step that dropped its coupon should not keep pointing at the old rule.
    if (!code) { priceRuleId = null; offerId = null }

    rows.push({
      // Preserve the row id so nothing downstream sees a "new" step on every save.
      ...(prior?.id ? { id: prior.id } : {}),
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
      updated_at: nowIso,
    })
  }

  // ── 4) Replace the step set in two statements.
  //
  // Why not upsert: (client_id, step_no) had no unique index (B1), and even
  // with one, reordering messages transiently collides on it — step_no is
  // CHECK-constrained to 1..3 so we can't park rows on a temporary value.
  // Deleting first and inserting the whole set in ONE statement avoids both.
  const { error: delErr } = await sb.from('cart_sequence_steps').delete().eq('client_id', userId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  let savedSteps: any[] = []
  if (rows.length) {
    const { data, error: insErr } = await sb.from('cart_sequence_steps').insert(rows).select()
    if (insErr) {
      // Best-effort restore so a failed save never destroys a live sequence.
      if (existing.length) await sb.from('cart_sequence_steps').insert(existing)
      return NextResponse.json(
        { error: `Could not save the messages: ${insErr.message}. Your previous sequence has been restored.` },
        { status: 500 }
      )
    }
    savedSteps = data || []
  }

  // ── 5) Bust the KV cache for every slug we touched. The /r/[slug] resolver
  //       caches step rows (coupon + shop domain) for 10 minutes, so without
  //       this an edited coupon takes effect only on the next TTL.
  const touched = new Set<string>()
  savedSteps.forEach(s => touched.add(s.tracking_slug))
  existing.forEach(s => touched.add(s.tracking_slug))
  for (const slug of touched) await invalidateLink(slug)

  // NOTE: discount codes belonging to removed steps are deliberately NOT
  // deleted from Shopify/Razorpay — messages already delivered may still carry
  // them, and revoking a code a customer is holding is worse than an orphan.
  // Clean them up from the Shopify admin when the campaign is well and truly over.

  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ''
  const withLinks = savedSteps
    .sort((a, b) => a.step_no - b.step_no)
    .map(s => ({ ...s, tracking_link: `${base}/r/${s.tracking_slug}` }))

  if (!/^https?:\/\//i.test(base)) {
    warnings.push('BASE_URL is not configured on this deployment, so tracking links are incomplete. Set BASE_URL in your Cloudflare Pages environment.')
  }

  return NextResponse.json({
    sequence: { ...seq, timezone: IST_TIMEZONE },
    steps: withLinks,
    warnings,
  })
}
