export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// GET /api/influencer-search?handle=priya_official&clientId=xxx
//
// Response states:
//   { status: 'not_found' }                   → handle not in global DB
//   { status: 'no_overlap', found: true }      → in DB but no overlap with client's collaborators
//   { status: 'overlap', found: true, matches } → overlapping with past collaborators

export async function GET(req: NextRequest) {
  const userId   = req.headers.get('x-user-id')
  const role     = req.headers.get('x-user-role')
  const { searchParams } = new URL(req.url)
  const raw      = searchParams.get('handle') || ''
  const requestedClientId = searchParams.get('clientId')

  // A client may only ever search within their own data. Admin/agency may pass
  // an explicit clientId. Without this, a logged-in client could supply another
  // brand's id and read that brand's influencer roster + audience overlaps.
  if (role === 'client' && requestedClientId && requestedClientId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const clientId = role === 'client' ? (userId || '') : (requestedClientId || userId || '')

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // Normalise handle — strip @, lowercase, trim
  const handle = raw.replace(/^@/, '').toLowerCase().trim()
  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // ── 1. Check handle exists in global DB ─────────────────────────────────
  const { data: global } = await sb
    .from('global_influencer_handles')
    .select('handle, display_name, total_clients')
    .eq('handle', handle)
    .maybeSingle()

  if (!global) {
    return NextResponse.json({ status: 'not_found', handle })
  }

  // ── 2. Get client's own past collaborators (influencers they've added) ───
  const { data: myInfluencers } = await sb
    .from('influencers')
    .select('id, name, handle')
    .eq('client_id', clientId)
    .not('handle', 'is', null)

  const myHandles = (myInfluencers || [])
    .map(i => ({ id: i.id, name: i.name, handle: (i.handle || '').toLowerCase().trim() }))
    .filter(i => i.handle && i.handle !== handle)

  if (myHandles.length === 0) {
    return NextResponse.json({
      status:       'no_overlap',
      found:        true,
      handle,
      displayName:  global.display_name,
      totalClients: global.total_clients,
      message:      'You have no past collaborations to compare against.',
    })
  }

  // ── 3. Find overlaps for the searched handle ─────────────────────────────
  // Check both directions: searched handle overlapping with others AND others overlapping with it
  const myHandleList = myHandles.map(i => i.handle)

  const [fwdRes, revRes] = await Promise.all([
    // searched → my collaborators  (searched handle_a, my collaborators as handle_b)
    sb.from('influencer_handle_overlaps')
      .select('handle_a, handle_b, overlap_pct, shared_visitors, category')
      .eq('handle_a', handle)
      .in('handle_b', myHandleList),
    // my collaborators → searched  (reverse direction)
    sb.from('influencer_handle_overlaps')
      .select('handle_a, handle_b, overlap_pct, shared_visitors, category')
      .in('handle_a', myHandleList)
      .eq('handle_b', handle),
  ])

  // Build a map: collaborator handle → best overlap entry (take the higher pct from either direction)
  const overlapMap: Record<string, { overlap_pct: number; shared_visitors: number; category: string | null }> = {}

  for (const row of (fwdRes.data || [])) {
    const key = row.handle_b
    const prev = overlapMap[key]
    if (!prev || row.overlap_pct > prev.overlap_pct) overlapMap[key] = row
  }
  for (const row of (revRes.data || [])) {
    const key = row.handle_a
    const prev = overlapMap[key]
    if (!prev || row.overlap_pct > prev.overlap_pct) overlapMap[key] = row
  }

  if (Object.keys(overlapMap).length === 0) {
    return NextResponse.json({
      status:       'no_overlap',
      found:        true,
      handle,
      displayName:  global.display_name,
      totalClients: global.total_clients,
      message:      'No audience overlap detected with your past collaborations.',
    })
  }

  // ── 4. Build matches list ────────────────────────────────────────────────
  const matches = Object.entries(overlapMap).map(([collabHandle, data]) => {
    const collab = myHandles.find(i => i.handle === collabHandle)
    return {
      collaboratorHandle: collabHandle,
      collaboratorName:   collab?.name || collabHandle,
      collaboratorId:     collab?.id || null,
      overlapPct:         data.overlap_pct,
      sharedVisitors:     data.shared_visitors,
      category:           data.category,
    }
  }).sort((a, b) => b.overlapPct - a.overlapPct)  // highest overlap first

  return NextResponse.json({
    status:       'overlap',
    found:        true,
    handle,
    displayName:  global.display_name,
    totalClients: global.total_clients,
    matches,
  })
}
