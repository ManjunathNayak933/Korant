export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('publications').select('*').eq('id', (await params).id).single()
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const body = await request.json()
  const allowed = ['publication_name', 'author_name', 'type', 'article_url', 'destination_url', 'estimated_reach', 'is_sponsored', 'published_at', 'cost', 'is_active', 'campaign_id']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  const { data, error } = await sb.from('publications').update(updates).eq('id', (await params).id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('publications').delete().eq('id', (await params).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
