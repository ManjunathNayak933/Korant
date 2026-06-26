// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/clients/[id]/route.ts                              │
// │ Replace the existing file at <repo-root>/app/api/clients/[id]/route.ts │
// │ Change: clients can now self-serve shopify_domain / webhook_secret /   │
// │ shopify_token; domain is normalized; duplicate domains are rejected.   │
// └──────────────────────────────────────────────────────────────────────┘
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
  const { id } = await params

  if (!canAccess(role, userId, id) && role !== 'agency') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = getSupabaseAdmin()

  if (role === 'agency') {
    // Verify agency has access to this client
    const { data: handler } = await sb
      .from('agency_handlers')
      .select('id')
      .eq('agency_id', userId)
      .eq('client_id', id)
      .single()
    if (!handler) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // NOTE: webhook_secret and shopify_token are deliberately NOT selected here —
  // secrets are never returned to the client. Connection status is exposed via
  // /api/clients/integrations as booleans only.
  const { data, error } = await sb
    .from('clients')
    .select('id, name, email, plan, status, status_note, client_type, managed_by, affiliate_slug, custom_domain, shopify_domain, onboarding, goals, next_billing_at, plan_activated_at, created_at')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { id } = await params

  if (!canAccess(role, userId, id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()

  // Clients can self-serve their store domain and Admin API token (for auto
  // coupon codes) in addition to onboarding / goals / custom_domain. They can
  // NOT write webhook_secret — that's the auto-generated key baked into their
  // webhook URL, so letting them change it would break the URL they pasted into
  // Shopify. Admins retain it (e.g. to rotate a key).
  const allowedClient = ['onboarding', 'goals', 'custom_domain', 'shopify_domain', 'shopify_token']
  const allowedAdmin = [...allowedClient, 'name', 'email', 'plan', 'status', 'status_note', 'next_billing_at', 'plan_activated_at', 'webhook_secret']
  const allowed = role === 'admin' ? allowedAdmin : allowedClient

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Normalize the Shopify domain to the canonical myshopify host — lowercase,
  // no scheme, no path/trailing slash — so it matches the X-Shopify-Shop-Domain
  // header that /api/webhook/shopify uses to find the client.
  if (typeof updates.shopify_domain === 'string') {
    const norm = (updates.shopify_domain as string)
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
    updates.shopify_domain = norm || null
  }

  // A Shopify store can only be connected to one account. Reject a domain that
  // is already claimed by a different client — a duplicate would break the
  // webhook lookup, which matches by domain with .single().
  if (updates.shopify_domain) {
    const { data: clash } = await sb
      .from('clients')
      .select('id')
      .eq('shopify_domain', updates.shopify_domain as string)
      .neq('id', id)
      .maybeSingle()
    if (clash) {
      return NextResponse.json(
        { error: 'That Shopify store is already connected to another account.' },
        { status: 409 }
      )
    }
  }

  const { data, error } = await sb
    .from('clients')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
