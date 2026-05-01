export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('agencies')
    .select('id, name, email, phone, website, services, status, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const body = await request.json()
  const { name, email, password, phone, website, services } = body
  if (!name || !email || !password) return NextResponse.json({ error: 'name, email, password required' }, { status: 400 })

  const { data: existing } = await sb.from('agencies').select('id').eq('email', email.toLowerCase()).single()
  if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 })

  const password_hash = await hashPassword(password)
  const { data, error } = await sb
    .from('agencies')
    .insert({ name, email: email.toLowerCase(), password_hash, phone, website, services: services || [] })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
