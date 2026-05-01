export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const body = await request.json()
  const { status, paid_via, utr_number, notes } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status) updates.status = status
  if (paid_via) updates.paid_via = paid_via
  if (utr_number) updates.utr_number = utr_number
  if (notes) updates.notes = notes
  if (status === 'paid') {
    updates.paid_at = new Date().toISOString()
    updates.paid_by = request.headers.get('x-user-id')
  }

  const { data, error } = await sb.from('payouts').update(updates).eq('id', (await params).id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
