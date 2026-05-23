export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

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
  const allowed = ['name', 'handle', 'email', 'phone', 'destination_url', 'discount_code', 'is_active', 'paused_reason', 'campaign_id', 'commission_type', 'commission_value']
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
  const { data, error } = await sb.from('affiliates').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
  const { error } = await sb.from('affiliates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
