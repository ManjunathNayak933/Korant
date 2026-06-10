export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('affiliate_programs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const clientId = body.clientId || (role === 'client' ? userId : null)

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!body.name || body.commission_value === undefined) {
    return NextResponse.json({ error: 'name, commission_value required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('affiliate_programs')
    .insert({
      client_id: clientId,
      name: body.name,
      description: body.description || '',
      commission_type: body.commission_type || 'percentage',
      commission_value: body.commission_value,
      commission_trigger: body.commission_trigger || 'per_sale',
      attribution_window_days: body.attribution_window_days || 30,
      is_public: body.is_public || false,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
