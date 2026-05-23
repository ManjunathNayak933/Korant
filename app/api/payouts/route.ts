export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
  const month = searchParams.get('month')

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  let query = sb.from('payouts').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
  if (month) query = query.eq('month', month)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()

  // Generate payouts for a month
  if (body.action === 'generate') {
    const clientId = body.clientId || (role === 'client' ? userId : null)
    const month = body.month // 'YYYY-MM'
    if (!clientId || !month) return NextResponse.json({ error: 'clientId and month required' }, { status: 400 })
    if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sb = getSupabaseAdmin()
    const monthStart = `${month}-01`
    // Calculate the actual last day of the month (handles Feb, 30-day months, leap years)
    const lastDay = new Date(month + '-01')
    lastDay.setMonth(lastDay.getMonth() + 1)
    lastDay.setDate(0)
    const monthEnd = lastDay.toISOString().slice(0, 10)

    // Influencer payouts (fee-based)
    const { data: influencers } = await sb
      .from('influencers')
      .select('id, name, handle, fee')
      .eq('client_id', clientId)
      .eq('is_active', true)

    // Check which had activity
    const { data: infEvents } = await sb
      .from('events')
      .select('influencer_id')
      .eq('client_id', clientId)
      .gte('timestamp', monthStart)
      .lte('timestamp', monthEnd)
      .not('influencer_id', 'is', null)

    const activeInfIds = new Set((infEvents || []).map(e => e.influencer_id))

    const payoutInserts: any[] = []
    for (const inf of (influencers || [])) {
      if (activeInfIds.has(inf.id) && inf.fee > 0) {
        payoutInserts.push({
          client_id: clientId, entity_type: 'influencer', entity_id: inf.id,
          entity_name: inf.name, handle: inf.handle, amount: inf.fee,
          month, status: 'pending', source: 'fee',
        })
      }
    }

    // Affiliate payouts (commission-based)
    const { data: affCommissions } = await sb
      .from('events')
      .select('affiliate_id, commission_amount')
      .eq('client_id', clientId)
      .gte('timestamp', monthStart)
      .lte('timestamp', monthEnd)
      .not('affiliate_id', 'is', null)

    const affTotals: Record<string, number> = {}
    for (const e of (affCommissions || [])) {
      affTotals[e.affiliate_id] = (affTotals[e.affiliate_id] || 0) + (e.commission_amount || 0)
    }
    const { data: affiliates } = await sb.from('affiliates').select('id, name, handle').eq('client_id', clientId)
    for (const aff of (affiliates || [])) {
      if (affTotals[aff.id] > 0) {
        payoutInserts.push({
          client_id: clientId, entity_type: 'affiliate', entity_id: aff.id,
          entity_name: aff.name, handle: aff.handle, amount: affTotals[aff.id],
          month, status: 'pending', source: 'commission',
        })
      }
    }

    // Publication payouts
    const { data: pubs } = await sb
      .from('publications')
      .select('id, publication_name, cost, published_at')
      .eq('client_id', clientId)
      .gte('published_at', monthStart)
      .lte('published_at', monthEnd)

    for (const pub of (pubs || [])) {
      if (pub.cost > 0) {
        payoutInserts.push({
          client_id: clientId, entity_type: 'publication', entity_id: pub.id,
          entity_name: pub.publication_name, amount: pub.cost,
          month, status: 'pending', source: 'placement_fee',
        })
      }
    }

    if (payoutInserts.length === 0) return NextResponse.json({ message: 'No payouts to generate', count: 0 })

    const { data, error } = await sb
      .from('payouts')
      .upsert(payoutInserts, { onConflict: 'client_id,entity_id,month', ignoreDuplicates: true })
      .select()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ message: 'Payouts generated', count: data?.length || 0 }, { status: 201 })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
