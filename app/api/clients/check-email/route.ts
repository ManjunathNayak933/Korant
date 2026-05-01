export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const [{ data: client }, { data: agency }] = await Promise.all([
    sb.from('clients').select('id').eq('email', email.toLowerCase()).single(),
    sb.from('agencies').select('id').eq('email', email.toLowerCase()).single(),
  ])

  return NextResponse.json({ exists: !!(client || agency) })
}
