export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'

export async function GET(request: NextRequest, { params }: { params: Promise<{ clientSlug: string }> }) {
  const sb = getSupabaseAdmin()
  const { data: client } = await sb
    .from('clients')
    .select('id, name, affiliate_slug')
    .eq('affiliate_slug', (await params).clientSlug)
    .single()

  if (!client) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  const { data: program } = await sb
    .from('affiliate_programs')
    .select('id, name, description, commission_type, commission_value, commission_trigger, attribution_window_days')
    .eq('client_id', client.id)
    .eq('is_public', true)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!program) return NextResponse.json({ error: 'No active public program' }, { status: 404 })

  return NextResponse.json({ client: { name: client.name }, program })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ clientSlug: string }> }) {
  const sb = getSupabaseAdmin()
  const body = await request.json()

  const { name, email, handle } = body
  if (!name || !email || !handle) {
    return NextResponse.json({ error: 'name, email, handle required' }, { status: 400 })
  }

  const { data: client } = await sb
    .from('clients')
    .select('id, name')
    .eq('affiliate_slug', (await params).clientSlug)
    .single()

  if (!client) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  const { data: program } = await sb
    .from('affiliate_programs')
    .select('*')
    .eq('client_id', client.id)
    .eq('is_public', true)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!program) return NextResponse.json({ error: 'No active public program' }, { status: 404 })

  // Idempotent — check existing
  const { data: existing } = await sb
    .from('affiliates')
    .select('id, name, redirect_slug, discount_code')
    .eq('email', email.toLowerCase())
    .eq('program_id', program.id)
    .single()

  if (existing) {
    const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${existing.redirect_slug}`
    return NextResponse.json({
      welcome_back: true,
      name: existing.name,
      tracking_link: trackingLink,
      discount_code: existing.discount_code,
    })
  }

  // New signup
  const slugBase = handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const redirect_slug = await ensureUniqueSlug(`aff-${slugBase}`)
  const randomSuffix = Math.floor(Math.random() * 90 + 10)
  const discount_code = `${slugBase.toUpperCase().slice(0, 8)}${randomSuffix}`

  const { data: affiliate, error } = await sb
    .from('affiliates')
    .insert({
      client_id: client.id,
      program_id: program.id,
      source: 'public_signup',
      name,
      handle,
      email: email.toLowerCase(),
      phone: body.phone || null,
      redirect_slug,
      destination_url: body.destination_url || 'https://korant.app',
      discount_code,
      commission_type: program.commission_type,
      commission_value: program.commission_value,
      commission_trigger: program.commission_trigger,
      attribution_window_days: program.attribution_window_days,
      created_by: 'public',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${redirect_slug}`
  return NextResponse.json({ welcome_back: false, name, tracking_link: trackingLink, discount_code, affiliate_id: affiliate.id }, { status: 201 })
}
