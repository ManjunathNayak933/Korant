export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''

  let query = sb
    .from('clients')
    .select('id, name, email, plan, status, status_note, next_billing_at, created_at, affiliate_slug')
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('name', `%${search}%`)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  try {
    const body = await request.json()
    const { name, email, password, plan = 'basic', client_type = 'saas' } = body

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'name, email, password required' }, { status: 400 })
    }

    // Check email uniqueness
    const { data: existing } = await sb.from('clients').select('id').eq('email', email.toLowerCase()).single()
    if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })

    const password_hash = await hashPassword(password)
    const affiliate_slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now().toString(36)

    const { data, error } = await sb
      .from('clients')
      .insert({ name, email: email.toLowerCase(), password_hash, plan, client_type, affiliate_slug })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create client' }, { status: 500 })
  }
}
