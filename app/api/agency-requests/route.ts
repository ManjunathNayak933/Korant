export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const sb = getSupabaseAdmin()

  if (role === 'client') {
    // Client sees requests sent TO them
    const { data, error } = await sb
      .from('agency_requests')
      .select('*')
      .eq('client_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (role === 'agency') {
    const { data, error } = await sb
      .from('agency_requests')
      .select('*')
      .eq('agency_id', userId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (role === 'admin') {
    const { data, error } = await sb.from('agency_requests').select('*').order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  if (role !== 'agency' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const { client_email, services, message } = body

  if (!client_email || !services?.length) {
    return NextResponse.json({ error: 'client_email and services required' }, { status: 400 })
  }

  // Find client by email
  const { data: client } = await sb.from('clients').select('id, name').eq('email', client_email.toLowerCase()).single()
  if (!client) return NextResponse.json({ error: 'No client found with that email' }, { status: 404 })

  let agencyName = 'Admin'
  if (role === 'agency') {
    const { data: agency } = await sb.from('agencies').select('name').eq('id', userId).single()
    agencyName = agency?.name || 'Unknown Agency'
  }

  const { data, error } = await sb
    .from('agency_requests')
    .insert({
      agency_id: userId,
      agency_name: agencyName,
      client_id: client.id,
      client_email: client_email.toLowerCase(),
      client_name: client.name,
      services,
      message: message || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
