export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  if (role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const { action } = body

  if (!['accept', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept or reject' }, { status: 400 })
  }

  const { data: req } = await sb.from('agency_requests').select('*').eq('id', (await params).id).eq('client_id', userId).single()
  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (req.status !== 'pending') return NextResponse.json({ error: 'Already resolved' }, { status: 409 })

  const status = action === 'accept' ? 'accepted' : 'rejected'
  await sb.from('agency_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', (await params).id)

  if (action === 'accept') {
    // Create agency_handler records for each service
    const handlerInserts = req.services.map((service: string) => ({
      client_id: req.client_id,
      agency_id: req.agency_id,
      service,
      agency_name: req.agency_name,
      request_id: req.id,
      accepted_at: new Date().toISOString(),
    }))
    await sb.from('agency_handlers').upsert(handlerInserts, { onConflict: 'client_id,agency_id,service', ignoreDuplicates: true })

    // Update client managed_by
    await sb.from('clients').update({ managed_by: req.agency_name, updated_at: new Date().toISOString() }).eq('id', req.client_id)
  }

  return NextResponse.json({ ok: true, status })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Client withdraws agency (removes handlers)
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  if (role !== 'client') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { data: req } = await sb.from('agency_requests').select('agency_id').eq('id', (await params).id).single()
  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await sb.from('agency_handlers').delete().eq('client_id', userId).eq('agency_id', req.agency_id)
  await sb.from('agency_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', (await params).id)
  await sb.from('clients').update({ managed_by: 'korant', updated_at: new Date().toISOString() }).eq('id', userId)

  return NextResponse.json({ ok: true })
}
