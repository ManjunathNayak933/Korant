export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'
import { checkPlanLimit } from '@/lib/planLimits'
import { createShopifyDiscountCode } from '@/lib/shopify'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
  const programId = searchParams.get('programId')
  const source = searchParams.get('source') // 'public_signup' for ambassadors

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  let query = sb
    .from('affiliates')
    .select('id, name, handle, email, phone, redirect_slug, destination_url, discount_code, commission_type, commission_value, commission_trigger, attribution_window_days, is_active, paused_at, paused_reason, source, campaign_id, program_id, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (programId) query = query.eq('program_id', programId)
  if (source) query = query.eq('source', source)

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

  const limit = await checkPlanLimit(clientId, 'affiliates')
  if (!limit.allowed) return NextResponse.json({ error: limit.message }, { status: 403 })

  const sb = getSupabaseAdmin()

  // Get program defaults if programId provided
  let commissionType = body.commission_type || 'percentage'
  let commissionValue = body.commission_value || 10
  let commissionTrigger = body.commission_trigger || 'per_sale'
  let attributionWindow = body.attribution_window_days || 30

  if (body.program_id) {
    const { data: prog } = await sb.from('affiliate_programs').select('*').eq('id', body.program_id).single()
    if (prog) {
      commissionType = prog.commission_type
      commissionValue = prog.commission_value
      commissionTrigger = prog.commission_trigger
      attributionWindow = prog.attribution_window_days
    }
  }

  const slugBase = body.handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const redirect_slug = await ensureUniqueSlug(`aff-${slugBase}`)
  const discountCode = body.discount_code?.toUpperCase() || null

  const { data, error } = await sb
    .from('affiliates')
    .insert({
      client_id: clientId,
      campaign_id: body.campaign_id || null,
      program_id: body.program_id || null,
      source: body.source || 'manual',
      name: body.name,
      handle: body.handle,
      email: body.email || null,
      phone: body.phone || null,
      redirect_slug,
      destination_url: body.destination_url,
      discount_code: discountCode,
      commission_type: commissionType,
      commission_value: commissionValue,
      commission_trigger: commissionTrigger,
      attribution_window_days: attributionWindow,
      created_by: role,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Affiliate already exists in this program' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Try auto Shopify discount
  if (discountCode) {
    try {
      const shopifyResult = await createShopifyDiscountCode(clientId, discountCode)
      if (shopifyResult) {
        await sb.from('affiliates').update({ shopify_price_rule_id: shopifyResult.priceRuleId }).eq('id', data.id)
      }
    } catch {}
  }

  return NextResponse.json(data, { status: 201 })
}
