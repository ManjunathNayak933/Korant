export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  if (role !== 'admin' && userId !== (await params).id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { data: handlers, error } = await sb
    .from('agency_handlers')
    .select('client_id, service, accepted_at')
    .eq('agency_id', (await params).id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const clientIds = [...new Set((handlers || []).map(h => h.client_id))]
  if (clientIds.length === 0) return NextResponse.json([])

  const { data: clients } = await sb
    .from('clients')
    .select('id, name, email, plan, status, onboarding, created_at')
    .in('id', clientIds)

  const result = (clients || []).map(c => ({
    ...c,
    services: (handlers || []).filter(h => h.client_id === c.id).map(h => h.service),
  }))

  return NextResponse.json(result)
}
