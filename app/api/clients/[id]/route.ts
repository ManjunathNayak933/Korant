export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

function canAccess(role: string, userId: string, clientId: string) {
  return role === 'admin' || (role === 'client' && userId === clientId)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!

  if (!canAccess(role, userId, (await params).id) && role !== 'agency') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = getSupabaseAdmin()

  if (role === 'agency') {
    // Verify agency has access to this client
    const { data: handler } = await sb
      .from('agency_handlers')
      .select('id')
      .eq('agency_id', userId)
      .eq('client_id', (await params).id)
      .single()
    if (!handler) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await sb
    .from('clients')
    .select('id, name, email, plan, status, status_note, client_type, managed_by, affiliate_slug, custom_domain, shopify_domain, onboarding, goals, next_billing_at, plan_activated_at, created_at')
    .eq('id', (await params).id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!

  if (!canAccess(role, userId, (await params).id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()

  // Clients can only update onboarding, goals
  // Admins can update anything
  const allowedClient = ['onboarding', 'goals', 'custom_domain']
  const allowedAdmin = [...allowedClient, 'name', 'email', 'plan', 'status', 'status_note', 'next_billing_at', 'plan_activated_at', 'shopify_domain', 'shopify_token', 'webhook_secret']
  const allowed = role === 'admin' ? allowedAdmin : allowedClient

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await sb
    .from('clients')
    .update(updates)
    .eq('id', (await params).id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { error } = await sb.from('clients').delete().eq('id', (await params).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
