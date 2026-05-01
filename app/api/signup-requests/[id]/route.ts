export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const { action, rejected_reason } = body

  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const { data: req, error: fetchError } = await sb
    .from('signup_requests')
    .select('*')
    .eq('id', (await params).id)
    .single()

  if (fetchError || !req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (req.status !== 'pending') return NextResponse.json({ error: 'Request already processed' }, { status: 409 })

  if (action === 'reject') {
    await sb.from('signup_requests').update({ status: 'rejected', rejected_reason: rejected_reason || null, updated_at: new Date().toISOString() }).eq('id', (await params).id)
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  // Approve — create account
  try {
    let createdId: string

    if (req.type === 'client') {
      const affiliateSlug = req.brand_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now().toString(36)
      const { data: newClient, error: clientError } = await sb
        .from('clients')
        .insert({
          name: req.brand_name,
          email: req.email,
          password_hash: req.password_hash,
          plan: req.plan || 'basic',
          affiliate_slug: affiliateSlug,
        })
        .select('id')
        .single()

      if (clientError) return NextResponse.json({ error: `Failed to create client: ${clientError.message}` }, { status: 500 })
      createdId = newClient.id
    } else {
      const { data: newAgency, error: agencyError } = await sb
        .from('agencies')
        .insert({
          name: req.brand_name,
          email: req.email,
          password_hash: req.password_hash,
          phone: req.phone,
          services: req.services || [],
        })
        .select('id')
        .single()

      if (agencyError) return NextResponse.json({ error: `Failed to create agency: ${agencyError.message}` }, { status: 500 })
      createdId = newAgency.id
    }

    await sb.from('signup_requests').update({ status: 'approved', created_id: createdId, updated_at: new Date().toISOString() }).eq('id', (await params).id)
    return NextResponse.json({ ok: true, status: 'approved', created_id: createdId })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create account' }, { status: 500 })
  }
}
