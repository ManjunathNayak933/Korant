// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/influencers/route.ts                               │
// │ Replace the existing file at <repo-root>/app/api/influencers/route.ts  │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'
import { checkPlanLimit } from '@/lib/planLimits'
import { createShopifyDiscountCode } from '@/lib/shopify'
import { createRazorpayOffer } from '@/lib/razorpay'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
  const campaignId = searchParams.get('campaignId')

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  let query = sb
    .from('influencers')
    .select('id, name, handle, social_platform, social_url, fee, destination_url, redirect_slug, discount_code, is_active, campaign_id, created_at, influencer_campaigns(campaign_id)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  // Filter by campaign via junction table if campaignId provided
  if (campaignId) {
    const { data: junctionIds } = await sb
      .from('influencer_campaigns')
      .select('influencer_id')
      .eq('campaign_id', campaignId)
    const ids = (junctionIds || []).map((j: any) => j.influencer_id)
    if (ids.length === 0) return NextResponse.json([])
    query = query.in('id', ids)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const clientId = body.clientId || (role === 'client' ? userId : null)

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!body.name || !body.handle || !body.destination_url) {
    return NextResponse.json({ error: 'name, handle, destination_url required' }, { status: 400 })
  }

  const limit = await checkPlanLimit(clientId, 'influencers')
  if (!limit.allowed) return NextResponse.json({ error: limit.message }, { status: 403 })

  const sb = getSupabaseAdmin()
  const normalHandle = body.handle.replace(/^@/, '').toLowerCase().trim()

  // Check if this influencer already exists for this client
  const { data: existing } = await sb
    .from('influencers')
    .select('id, name, campaign_id')
    .eq('client_id', clientId)
    .ilike('handle', normalHandle)
    .eq('social_platform', body.social_platform || 'instagram')
    .maybeSingle()

  if (existing) {
    // Influencer already exists — just tag to the new campaign via junction table
    if (body.campaign_id && body.campaign_id !== existing.campaign_id) {
      await sb.from('influencer_campaigns').upsert({
        influencer_id: existing.id,
        campaign_id: body.campaign_id,
      }, { onConflict: 'influencer_id,campaign_id', ignoreDuplicates: true })
    }
    // BUG FIX: previously we returned `existing` which was selected with only
    // (id, name, campaign_id). The client prepended that stub to the influencer
    // list, producing a card with blank handle/platform, undefined is_active
    // (rendered as "paused"), and a dead Link button. Re-select the full row so
    // the returned object is a complete influencer.
    const { data: full } = await sb
      .from('influencers')
      .select('id, name, handle, social_platform, social_url, fee, destination_url, redirect_slug, discount_code, is_active, campaign_id, created_at')
      .eq('id', existing.id)
      .single()
    return NextResponse.json({ ...(full || existing), _existed: true }, { status: 200 })
  }

  const slugBase = normalHandle.replace(/[^a-z0-9]/g, '')
  const redirect_slug = await ensureUniqueSlug(slugBase)

  const discountCode = body.discount_code?.toUpperCase() || null

  const { data, error } = await sb
    .from('influencers')
    .insert({
      client_id: clientId,
      campaign_id: body.campaign_id || null,
      name: body.name,
      handle: body.handle,
      social_platform: body.social_platform || 'instagram',
      social_url: body.social_url || '',
      fee: body.fee || 0,
      destination_url: body.destination_url,
      redirect_slug,
      discount_code: discountCode,
      created_by: role,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Discount code already used for this client' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-create discount codes on Shopify and Razorpay
  if (discountCode) {
    try {
      const [shopifyResult, razorpayResult] = await Promise.allSettled([
        createShopifyDiscountCode(clientId, discountCode),
        createRazorpayOffer(clientId, discountCode),
      ])
      const updates: Record<string, unknown> = {}
      if (shopifyResult.status === 'fulfilled' && shopifyResult.value) {
        updates.shopify_price_rule_id = shopifyResult.value.priceRuleId
      }
      if (razorpayResult.status === 'fulfilled' && razorpayResult.value) {
        updates.razorpay_offer_id = razorpayResult.value.offerId
      }
      if (Object.keys(updates).length > 0) {
        await sb.from('influencers').update(updates).eq('id', data.id)
      }
    } catch {}
  }

  // Also write to junction table if campaign assigned
  if (data && body.campaign_id) {
    await sb.from('influencer_campaigns').upsert({
      influencer_id: data.id,
      campaign_id: body.campaign_id,
    }, { onConflict: 'influencer_id,campaign_id', ignoreDuplicates: true })
  }

  return NextResponse.json(data, { status: 201 })
}
