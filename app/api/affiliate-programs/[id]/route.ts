// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/affiliate-programs/[id]/route.ts                   │
// │ Replace the existing file at <repo-root>/app/api/affiliate-programs/[id]/route.ts │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

async function getOwnedProgram(id: string, role: string, userId: string) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('affiliate_programs').select('*').eq('id', id).single()
  if (error || !data) return { data: null, forbidden: false }
  if (role === 'admin') return { data, forbidden: false }
  if (role === 'client' && data.client_id !== userId) return { data: null, forbidden: true }
  if (role === 'agency') {
    const { data: rel } = await sb.from('agency_handlers').select('id').eq('agency_id', userId).eq('client_id', data.client_id).single()
    if (!rel) return { data: null, forbidden: true }
  }
  return { data, forbidden: false }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data: existing, forbidden } = await getOwnedProgram(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['name', 'description', 'commission_type', 'commission_value', 'commission_trigger', 'attribution_window_days', 'is_public', 'is_active']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  const { data, error } = await sb.from('affiliate_programs').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params
  const { data: existing, forbidden } = await getOwnedProgram(id, role, userId)
  if (forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabaseAdmin()
  // Affiliates reference program_id via FK with no ON DELETE action, so a raw
  // delete would throw an opaque 23503. Check first and return a clear message.
  const { count } = await sb
    .from('affiliates')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', id)
  if ((count || 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${count} affiliate${count === 1 ? ' is' : 's are'} still in this program. Reassign or remove them first.` },
      { status: 409 }
    )
  }
  const { error } = await sb.from('affiliate_programs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
