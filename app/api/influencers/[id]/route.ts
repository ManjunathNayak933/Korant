// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/influencers/[id]/route.ts                          │
// │ Replace the existing file at <repo-root>/app/api/influencers/[id]/route.ts │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createShopifyDiscountCode, updateShopifyDiscountCode, deleteShopifyPriceRule } from '@/lib/shopify'
import { invalidateLink } from '@/lib/links'
import { findDiscountCodeOwner, codeConflictMessage } from '@/lib/codes'

async function getOwnedInfluencer(id: string, role: string, userId: string) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('influencers').select('*').eq('id', id).single()
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
  const { data, forbidden } = await getOwnedInfluencer(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data: existing, forbidden } = await getOwnedInfluencer(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['name', 'handle', 'social_platform', 'social_url', 'fee', 'destination_url', 'discount_code', 'is_active', 'campaign_id', 'commission_type', 'commission_value', 'commission_trigger']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Keep commission fields internally consistent: a positive value implies a
  // 'per_sale' trigger unless explicitly set; a zero/blank value disables it.
  if ('commission_value' in body || 'commission_type' in body || 'commission_trigger' in body) {
    const value = Number(updates.commission_value ?? existing.commission_value) || 0
    updates.commission_value = value
    if ('commission_type' in updates) updates.commission_type = updates.commission_type === 'flat' ? 'flat' : 'percentage'
    updates.commission_trigger = value > 0 ? ((updates.commission_trigger as string) || existing.commission_trigger || 'per_sale') : 'none'
  }

  // BUG FIX: a discount-code change must propagate to Shopify, or the store and
  // Korant diverge. Normalise to uppercase (as on creation), then update/create/delete.
  if ('discount_code' in body) {
    const newCode = body.discount_code ? String(body.discount_code).toUpperCase() : null
    updates.discount_code = newCode
    // Reject a code already owned by a different asset for this client.
    if (newCode) {
      const owner = await findDiscountCodeOwner(existing.client_id, newCode, { table: 'influencers', id })
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

  const { data, error } = await sb.from('influencers').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // BUG FIX: the /r/[slug] redirect caches the resolved link (destination URL +
  // partner name) in KV for 10 min. Without busting it, an edited destination_url
  // or renamed influencer kept serving stale data until the TTL expired. The
  // redirect_slug itself is immutable, so the existing slug is the right key.
  await invalidateLink(existing.redirect_slug)
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data: existing, forbidden } = await getOwnedInfluencer(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabaseAdmin()
  if (existing.shopify_price_rule_id) {
    await deleteShopifyPriceRule(existing.client_id, existing.shopify_price_rule_id)
  }
  const { error } = await sb.from('influencers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Drop the cached link so /r/[slug] stops resolving a deleted partner.
  await invalidateLink(existing.redirect_slug)
  return NextResponse.json({ ok: true })
}
