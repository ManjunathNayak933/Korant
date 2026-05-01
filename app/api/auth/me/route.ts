export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const token = request.cookies.get('mk_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (payload.role === 'admin') {
    return NextResponse.json({ id: 'admin', role: 'admin', email: payload.email, name: 'Admin', status: 'active' })
  }

  const sb = getSupabaseAdmin()

  if (payload.role === 'client') {
    const { data } = await sb
      .from('clients')
      .select('id, name, email, status, status_note, plan, onboarding, goals, managed_by')
      .eq('id', payload.sub)
      .single()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ...data, role: 'client' })
  }

  if (payload.role === 'agency') {
    const { data } = await sb
      .from('agencies')
      .select('id, name, email, status, services')
      .eq('id', payload.sub)
      .single()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ...data, role: 'agency' })
  }

  return NextResponse.json({ error: 'Unknown role' }, { status: 400 })
}
