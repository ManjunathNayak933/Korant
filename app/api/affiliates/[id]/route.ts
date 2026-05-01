export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('affiliates').select('*').eq('id', (await params).id).single()
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['name', 'handle', 'email', 'phone', 'destination_url', 'discount_code', 'is_active', 'paused_reason', 'campaign_id', 'commission_type', 'commission_value']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Handle pause/resume
  if ('is_active' in body) {
    if (body.is_active === false) {
      updates.paused_at = new Date().toISOString()
      if (body.paused_reason) updates.paused_reason = body.paused_reason
    } else {
      updates.paused_at = null
      updates.paused_reason = null
    }
  }

  const { data, error } = await sb.from('affiliates').update(updates).eq('id', (await params).id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('affiliates').delete().eq('id', (await params).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
