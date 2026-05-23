export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role   = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params

  const sb = getSupabaseAdmin()

  // Fetch payout first and verify ownership
  const { data: existing } = await sb.from('payouts').select('client_id').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'client' && existing.client_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { status, paid_via, utr_number, notes } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status)     updates.status     = status
  if (paid_via)   updates.paid_via   = paid_via
  if (utr_number) updates.utr_number = utr_number
  if (notes)      updates.notes      = notes
  if (status === 'paid') {
    updates.paid_at = new Date().toISOString()
    updates.paid_by = userId
  }

  const { data, error } = await sb.from('payouts').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
