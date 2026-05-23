// Influencer Center logic.
// No new tables. Reads from existing influencers + events tables.
// The SQL view (influencer_center) does all aggregation.

import { getSupabaseAdmin } from '@/lib/supabase'

// Audience overlap — compares prospect influencer's visitor_ids against
// the logged-in brand's existing influencers' visitor_ids.
// Scoped entirely to the requesting client's own events data.
export async function getAudienceOverlap(
  prospectHandle: string,
  prospectPlatform: string,
  clientId: string,
): Promise<Array<{ influencerName: string; handle: string; overlapPercent: number }>> {
  const sb = getSupabaseAdmin()
  const normalHandle = prospectHandle.replace(/^@/, '').toLowerCase().trim()

  // Get all influencer IDs that match this handle+platform (across all clients)
  const { data: prospectInfluencers } = await sb
    .from('influencers')
    .select('id')
    .ilike('handle', normalHandle)
    .eq('platform', prospectPlatform)

  if (!prospectInfluencers?.length) return []
  const prospectIds = prospectInfluencers.map(i => i.id)

  // Get visitor_ids who clicked any of the prospect's links
  // We only read visitor_id — no revenue, no client data
  const { data: prospectVisitors } = await sb
    .from('events')
    .select('visitor_id')
    .in('influencer_id', prospectIds)
    .eq('type', 'click')
    .not('visitor_id', 'is', null)

  if (!prospectVisitors?.length) return []
  const prospectVisitorSet = new Set(prospectVisitors.map(e => e.visitor_id))

  // Get THIS client's active influencers
  const { data: myInfluencers } = await sb
    .from('influencers')
    .select('id, name, handle')
    .eq('client_id', clientId)
    .eq('is_active', true)

  if (!myInfluencers?.length) return []

  const overlaps: Array<{ influencerName: string; handle: string; overlapPercent: number }> = []

  for (const inf of myInfluencers) {
    // Skip if this is the same influencer
    if (prospectIds.includes(inf.id)) continue

    // Get this client's influencer's visitors — strictly client-scoped
    const { data: myVisitors } = await sb
      .from('events')
      .select('visitor_id')
      .eq('influencer_id', inf.id)
      .eq('client_id', clientId)
      .eq('type', 'click')
      .not('visitor_id', 'is', null)

    if (!myVisitors?.length) continue

    const myVisitorSet = new Set(myVisitors.map(e => e.visitor_id))
    const shared = [...myVisitorSet].filter(v => prospectVisitorSet.has(v)).length
    const overlapPercent = Math.round((shared / myVisitorSet.size) * 100)

    if (overlapPercent >= 10) {
      overlaps.push({ influencerName: inf.name, handle: inf.handle, overlapPercent })
    }
  }

  return overlaps.sort((a, b) => b.overlapPercent - a.overlapPercent)
}
