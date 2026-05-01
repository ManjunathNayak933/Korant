export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['name', 'description', 'commission_type', 'commission_value', 'commission_trigger', 'attribution_window_days', 'is_public', 'is_active']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  const { data, error } = await sb.from('affiliate_programs').update(updates).eq('id', (await params).id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('affiliate_programs').delete().eq('id', (await params).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
