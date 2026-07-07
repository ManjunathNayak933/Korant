// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/cart-sequence/route.ts   (NEW FILE)            │
// │ Create at <repo-root>/app/api/whatsapp/cart-sequence/route.ts              │
// │                                                                            │
// │ GET  → the brand's current sequence config + up to 3 steps.               │
// │ PUT  → save it. Creates a per-step tracking slug (the "3 UTM links"),      │
// │        and, when a step carries a coupon, creates it on Shopify/Razorpay   │
// │        exactly like the campaign create route does.                        │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'
import { createShopifyDiscountCode } from '@/lib/shopify'
import { createRazorpayOffer } from '@/lib/razorpay'
import { findDiscountCodeOwner } from '@/lib/codes'

export const dynamic = 'force-dynamic'

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
    sequence: seq || { enabled: false, send_hour: 10, timezone: 'Asia/Kolkata', expiry_days: 14 },
    steps: withLinks,
  })
}

export async function PUT(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const { enabled = false, send_hour = 10, timezone = 'Asia/Kolkata', expiry_days = 14, steps = [] } = body

  if (!Array.isArray(steps) || steps.length > 3) {
    return NextResponse.json({ error: 'steps must be an array of at most 3' }, { status: 400 })
  }
  const hour = Math.max(0, Math.min(23, Number(send_hour) || 10))

  const sb = getSupabaseAdmin()

  // 1) Upsert the per-client sequence config.
  const { data: seq, error: seqErr } = await sb
    .from('cart_sequences')
    .upsert({
      client_id: userId, enabled: !!enabled, send_hour: hour,
      timezone: timezone || 'Asia/Kolkata', expiry_days: Number(expiry_days) || 14,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select().single()
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })

  // Existing steps, so we can reuse slugs (don't churn tracking links on edit).
  const { data: existing } = await sb
    .from('cart_sequence_steps').select('*').eq('client_id', userId)
  const existingByNo: Record<number, any> = {}
  ;(existing || []).forEach(s => { existingByNo[s.step_no] = s })

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
    let priceRuleId: number | null = existingByNo[stepNo]?.shopify_price_rule_id || null
    let offerId: string | null = existingByNo[stepNo]?.razorpay_offer_id || null

    // Only touch discount providers when the code is new or changed for this step.
    const codeChanged = code && code !== (existingByNo[stepNo]?.coupon_code || null)
    if (code && codeChanged) {
      // Guard: refuse a code another asset already owns (shared codes silently
      // lose attribution — see lib/codes.ts). Cart steps are new owners here.
      const owner = await findDiscountCodeOwner(userId, code)
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
        delay_days: Math.max(0, Number(s.delay_days) || 1),
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

    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ''
    savedSteps.push({ ...saved, tracking_link: `${base}/r/${saved.tracking_slug}` })
  }

  // Remove any steps the brand dropped (e.g. went from 3 steps down to 2).
  const keep = savedSteps.map(s => s.step_no)
  const toDelete = (existing || []).filter(s => !keep.includes(s.step_no)).map(s => s.step_no)
  if (toDelete.length) {
    await sb.from('cart_sequence_steps').delete().eq('client_id', userId).in('step_no', toDelete)
  }

  return NextResponse.json({ sequence: seq, steps: savedSteps, warnings })
}
