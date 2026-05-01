export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { deleteShopifyPriceRule } from '@/lib/shopify'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('influencers').select('*').eq('id', (await params).id).single()
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['name', 'handle', 'social_platform', 'social_url', 'fee', 'destination_url', 'discount_code', 'is_active', 'campaign_id']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await sb.from('influencers').update(updates).eq('id', (await params).id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { data: inf } = await sb.from('influencers').select('client_id, shopify_price_rule_id').eq('id', (await params).id).single()

  if (inf?.shopify_price_rule_id) {
    await deleteShopifyPriceRule(inf.client_id, inf.shopify_price_rule_id)
  }

  const { error } = await sb.from('influencers').delete().eq('id', (await params).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
