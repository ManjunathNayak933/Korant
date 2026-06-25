// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/affiliates/[id]/route.ts                           │
// │ Replace the existing file at <repo-root>/app/api/affiliates/[id]/route.ts │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createShopifyDiscountCode, updateShopifyDiscountCode, deleteShopifyPriceRule } from '@/lib/shopify'
import { invalidateLink } from '@/lib/links'
import { findDiscountCodeOwner, codeConflictMessage } from '@/lib/codes'

// Helper: verify the requesting user owns this affiliate (or is admin/agency)
async function getOwnedAffiliate(id: string, role: string, userId: string) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('affiliates').select('*').eq('id', id).single()
  if (error || !data) return { data: null, forbidden: false }
  if (role === 'admin') return { data, forbidden: false }
  if (role === 'client' && data.client_id !== userId) return { data: null, forbidden: true }
  if (role === 'agency') {
    const { data: rel } = await sb.from('agency_handlers').select('id').eq('agency_id', userId).eq('client_id', data.client_id).single()
    if (!rel) return { data: null, forbidden: true }
  }
  return { data, forbidden: false }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data, forbidden } = await getOwnedAffiliate(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data: existing, forbidden } = await getOwnedAffiliate(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['name', 'handle', 'email', 'phone', 'destination_url', 'discount_code', 'is_active', 'paused_reason', 'campaign_id', 'program_id', 'commission_type', 'commission_value']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  if ('is_active' in body) {
    if (body.is_active === false) {
      updates.paused_at = new Date().toISOString()
      if (body.paused_reason) updates.paused_reason = body.paused_reason
    } else {
      updates.paused_at = null
      updates.paused_reason = null
    }
  }

  // BUG FIX: a discount-code change must propagate to the store, or Korant and
  // Shopify diverge and commission keys off a code customers can't apply. Normalise
  // to uppercase (as on creation), then update / create / delete the Shopify code.
  if ('discount_code' in body) {
    const newCode = body.discount_code ? String(body.discount_code).toUpperCase() : null
    updates.discount_code = newCode
    if (newCode) {
      const owner = await findDiscountCodeOwner(existing.client_id, newCode, { table: 'affiliates', id })
      if (owner) return NextResponse.json({ error: codeConflictMessage(newCode, owner) }, { status: 409 })
    }
    try {
      if (newCode) {
        if (existing.shopify_price_rule_id) {
          await updateShopifyDiscountCode(existing.client_id, existing.shopify_price_rule_id, newCode)
        } else {
          const r = await createShopifyDiscountCode(existing.client_id, newCode)
          if (r) updates.shopify_price_rule_id = r.priceRuleId
        }
      } else if (existing.shopify_price_rule_id) {
        await deleteShopifyPriceRule(existing.client_id, existing.shopify_price_rule_id)
        updates.shopify_price_rule_id = null
      }
    } catch { /* discount sync is best-effort; never block the edit */ }
  }

  const { data, error } = await sb.from('affiliates').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Edited destination_url / name would otherwise stay cached on /r/[slug] for ~10 min.
  await invalidateLink(existing.redirect_slug)
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data: existing, forbidden } = await getOwnedAffiliate(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabaseAdmin()
  // BUG FIX: remove the affiliate's Shopify discount so it isn't left live and
  // redeemable after deletion (the influencer delete already did this).
  if (existing.shopify_price_rule_id) {
    await deleteShopifyPriceRule(existing.client_id, existing.shopify_price_rule_id)
  }
  const { error } = await sb.from('affiliates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await invalidateLink(existing.redirect_slug)
  return NextResponse.json({ ok: true })
}
