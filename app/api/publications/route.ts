export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ensureUniqueSlug } from '@/lib/tracking'
import { checkPlanLimit } from '@/lib/planLimits'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('publications')
    .select('id, publication_name, author_name, type, article_url, redirect_slug, destination_url, estimated_reach, is_sponsored, published_at, cost, is_active, campaign_id, created_at')
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
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!body.publication_name || !body.destination_url) {
    return NextResponse.json({ error: 'publication_name, destination_url required' }, { status: 400 })
  }

  const limit = await checkPlanLimit(clientId, 'publications')
  if (!limit.allowed) return NextResponse.json({ error: limit.message }, { status: 403 })

  const sb = getSupabaseAdmin()
  const slugBase = body.publication_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20)
  const redirect_slug = await ensureUniqueSlug(`pub-${slugBase}`)

  const { data, error } = await sb
    .from('publications')
    .insert({
      client_id: clientId,
      campaign_id: body.campaign_id || null,
      publication_name: body.publication_name,
      author_name: body.author_name || null,
      type: body.type || 'article',
      article_url: body.article_url || null,
      redirect_slug,
      destination_url: body.destination_url,
      estimated_reach: body.estimated_reach || null,
      is_sponsored: body.is_sponsored || false,
      published_at: body.published_at || null,
      cost: body.cost || 0,
      created_by: role,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
