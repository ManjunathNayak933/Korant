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

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin)
}

function corsHeaders(origin: string) {
  // Only set ACAO for known origins. Unknown origins get no CORS header
  // so the browser blocks the response — but critically we also gate the
  // POST handler itself so unknown origins can't write data at all.
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

// Handle preflight
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin') || ''
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 })
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
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
  const origin = request.headers.get('origin') || ''
  const headers = isAllowedOrigin(origin) ? corsHeaders(origin) : {}
  return NextResponse.json(data, { headers })
}

export async function POST(request: NextRequest) {
  // Block POST from unknown origins — CORS alone doesn't stop server-side processing
  const origin = request.headers.get('origin') || ''
  if (origin && !isAllowedOrigin(origin)) {
    return new NextResponse(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  const cors = isAllowedOrigin(origin) ? corsHeaders(origin) : {}

  const body = await request.json()
  const type          = body.type
  const full_name     = body.full_name  || body.fullName
  const brand_name    = body.brand_name || body.brandName
  const email         = body.email
  const phone         = body.phone
  const password      = body.password
  const plan          = body.plan
  const services      = body.services
  const note          = body.note
  const industry      = body.businessCategory || body.industry || null

  if (!type || !full_name || !brand_name || !email || !phone || !password) {
    return NextResponse.json({ error: 'All required fields must be filled' }, { status: 400, headers: cors })
  }
  if (!['client', 'agency'].includes(type)) {
    return NextResponse.json({ error: 'type must be client or agency' }, { status: 400, headers: cors })
  }

  const sb = getSupabaseAdmin()

  const [{ data: existingClient }, { data: existingAgency }, { data: existingRequest }] = await Promise.all([
    sb.from('clients').select('id').eq('email', email.toLowerCase()).single(),
    sb.from('agencies').select('id').eq('email', email.toLowerCase()).single(),
    sb.from('signup_requests').select('id').eq('email', email.toLowerCase()).eq('status', 'pending').single(),
  ])

  if (existingClient || existingAgency) return NextResponse.json({ error: 'Email already registered' }, { status: 409, headers: cors })
  if (existingRequest) return NextResponse.json({ error: 'Signup request already pending for this email' }, { status: 409, headers: cors })

  const password_hash = await hashPassword(password)

  const { data, error } = await sb
    .from('signup_requests')
    .insert({ type, full_name, brand_name, email: email.toLowerCase(), phone, password_hash, plan, services: services || [], industry, note: note || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: cors })
  return NextResponse.json({ id: data.id, message: 'Request submitted. You will be notified once approved.' }, { status: 201, headers: cors })
}
