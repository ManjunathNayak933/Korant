export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { deleteShopifyPriceRule } from '@/lib/shopify'

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
  const allowed = ['name', 'handle', 'social_platform', 'social_url', 'fee', 'destination_url', 'discount_code', 'is_active', 'campaign_id']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  const { data, error } = await sb.from('influencers').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
  return NextResponse.json({ ok: true })
}
