export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'

const ALLOWED_ORIGINS = [
  'https://www.microkorant.in',
  'https://microkorant.in',
  'https://app.microkorant.in',
]

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

// Handle preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || ''
  const sb = getSupabaseAdmin()

  let query = sb.from('signup_requests').select('*').order('created_at', { ascending: false })
  if (status && status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { headers: corsHeaders(request) })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const type       = body.type
  const full_name  = body.full_name  || body.fullName
  const brand_name = body.brand_name || body.brandName
  const email      = body.email
  const phone      = body.phone
  const password   = body.password
  const plan       = body.plan
  const services   = body.services
  const note       = body.note

  if (!type || !full_name || !brand_name || !email || !phone || !password) {
    return NextResponse.json({ error: 'All required fields must be filled' }, { status: 400, headers: corsHeaders(request) })
  }
  if (!['client', 'agency'].includes(type)) {
    return NextResponse.json({ error: 'type must be client or agency' }, { status: 400, headers: corsHeaders(request) })
  }

  const sb = getSupabaseAdmin()

  const [{ data: existingClient }, { data: existingAgency }, { data: existingRequest }] = await Promise.all([
    sb.from('clients').select('id').eq('email', email.toLowerCase()).single(),
    sb.from('agencies').select('id').eq('email', email.toLowerCase()).single(),
    sb.from('signup_requests').select('id').eq('email', email.toLowerCase()).eq('status', 'pending').single(),
  ])

  if (existingClient || existingAgency) return NextResponse.json({ error: 'Email already registered' }, { status: 409, headers: corsHeaders(request) })
  if (existingRequest) return NextResponse.json({ error: 'Signup request already pending for this email' }, { status: 409, headers: corsHeaders(request) })

  const password_hash = await hashPassword(password)

  const { data, error } = await sb
    .from('signup_requests')
    .insert({ type, full_name, brand_name, email: email.toLowerCase(), phone, password_hash, plan, services: services || [], note: note || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(request) })
  return NextResponse.json({ id: data.id, message: 'Request submitted. You will be notified once approved.' }, { status: 201, headers: corsHeaders(request) })
}