export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()
  const { data } = await sb.from('clients').select('goals').eq('id', userId).single()
  return NextResponse.json(data?.goals || {})
}

export async function PATCH(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const sb = getSupabaseAdmin()
  const { data: current } = await sb.from('clients').select('goals').eq('id', userId).single()
  const mergedGoals = { ...(current?.goals || {}), ...body }
  await sb.from('clients').update({ goals: mergedGoals, updated_at: new Date().toISOString() }).eq('id', userId)
  return NextResponse.json(mergedGoals)
}
