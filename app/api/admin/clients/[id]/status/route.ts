export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status) updates.status = body.status
  if (body.status_note !== undefined) updates.status_note = body.status_note
  if (body.plan) updates.plan = body.plan
  if (body.next_billing_at) updates.next_billing_at = body.next_billing_at
  if (body.plan_activated_at) updates.plan_activated_at = body.plan_activated_at

  const { data, error } = await sb.from('clients').update(updates).eq('id', (await params).id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
