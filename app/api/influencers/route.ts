export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { generateSlug, ensureUniqueSlug } from '@/lib/tracking'
import { checkPlanLimit } from '@/lib/planLimits'
import { createShopifyDiscountCode, updateShopifyDiscountCode, deleteShopifyPriceRule } from '@/lib/shopify'
import { createRazorpayOffer } from '@/lib/razorpay'
import { cacheDel, listKey } from '@/lib/cache'

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
    .select('id, name, handle, social_platform, social_url, fee, destination_url, redirect_slug, discount_code, is_active, campaign_id, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (campaignId) query = query.eq('campaign_id', campaignId)

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
  const slugBase = body.handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
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

  await cacheDel(listKey('influencers', clientId))
  return NextResponse.json(data, { status: 201 })
}