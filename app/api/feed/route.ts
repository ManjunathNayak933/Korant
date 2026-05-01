export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!

  if (role === 'admin') return NextResponse.json({ items: [], alerts: [] })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const dayAgo = new Date(now.getTime() - 86400000).toISOString()
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000).toISOString()

  // Recent events
  const { data: recentEvents } = await sb
    .from('events')
    .select('id, type, influencer_id, affiliate_id, publication_id, order_value, discount_code, timestamp, commission_amount, city, platform')
    .eq('client_id', clientId)
    .gte('timestamp', dayAgo)
    .order('timestamp', { ascending: false })
    .limit(20)

  // Inactive influencers
  const { data: influencers } = await sb
    .from('influencers')
    .select('id, name, handle')
    .eq('client_id', clientId)
    .eq('is_active', true)

  const { data: recentClicks } = await sb
    .from('events')
    .select('influencer_id')
    .eq('client_id', clientId)
    .eq('type', 'click')
    .gte('timestamp', twoWeeksAgo)
    .not('influencer_id', 'is', null)

  const activeInfluencerIds = new Set((recentClicks || []).map(e => e.influencer_id))
  const inactiveInfluencers = (influencers || []).filter(i => !activeInfluencerIds.has(i.id))

  // Pending payouts
  const { count: pendingPayouts } = await sb
    .from('payouts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'pending')

  // New ambassador signups this week
  const { data: newAmbassadors } = await sb
    .from('affiliates')
    .select('id, name, handle, created_at')
    .eq('client_id', clientId)
    .eq('source', 'public_signup')
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false })
    .limit(3)

  const items = (recentEvents || []).map(e => ({
    id: e.id,
    type: e.type,
    order_value: e.order_value,
    discount_code: e.discount_code,
    timestamp: e.timestamp,
    commission_amount: e.commission_amount,
    city: e.city,
    platform: e.platform,
    entity_type: e.influencer_id ? 'influencer' : e.affiliate_id ? 'affiliate' : 'publication',
    entity_id: e.influencer_id || e.affiliate_id || e.publication_id,
  }))

  const alerts: any[] = []
  for (const inf of inactiveInfluencers.slice(0, 3)) {
    alerts.push({ type: 'inactive_influencer', message: `${inf.name} — no clicks in 14 days`, entityId: inf.id, handle: inf.handle })
  }
  if ((pendingPayouts || 0) > 0) {
    alerts.push({ type: 'pending_payouts', message: `${pendingPayouts} pending payout(s) this month` })
  }
  for (const aff of (newAmbassadors || [])) {
    items.unshift({ id: aff.id, type: 'ambassador_signup', timestamp: aff.created_at, entity_type: 'affiliate', name: aff.name, handle: aff.handle })
  }

  return NextResponse.json({ items, alerts })
}
