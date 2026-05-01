export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { email, name, brand } = body
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  try {
    await sb.from('marketplace_waitlist').insert({ email: email.toLowerCase(), name, brand, created_at: new Date().toISOString() })
    return NextResponse.json({ ok: true, message: 'Added to waitlist' })
  } catch {
    return NextResponse.json({ ok: true, message: 'Already on waitlist' })
  }
}
