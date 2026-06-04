export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// GET /api/influencers/check?handle=X&platform=Y&clientId=Z
// Returns:
//   { status: 'own'      } — already in this client's account
//   { status: 'platform' } — in Influencer Center (other brands tracked her)
//   { status: 'new'      } — never seen before
export async function GET(request: NextRequest) {
  const role   = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)

  const handle   = searchParams.get('handle')?.replace(/^@/, '').toLowerCase().trim()
  const platform = searchParams.get('platform') || 'instagram'
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)

  if (!handle || !clientId) return NextResponse.json({ status: 'new' })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()

  // Run both checks in parallel
  const [ownRes, platformRes] = await Promise.all([
    // 1. Already in this client's account?
    sb.from('influencers')
      .select('id, name, handle, social_platform, social_url, fee, redirect_slug, discount_code, is_active, campaign_id')
      .eq('client_id', clientId)
      .ilike('handle', handle)
      .eq('social_platform', platform)
      .maybeSingle(),

    // 2. In Influencer Center? (other brands tracked her — meets 500 click threshold)
    sb.from('influencer_center')
      .select('handle, platform, name, social_url, total_clicks, total_revenue, avg_clicks_per_content, brand_count, best_fit_category, best_fit_label')
      .ilike('handle', handle)
      .eq('platform', platform)
      .eq('meets_threshold', true)
      .maybeSingle(),
  ])

  // Get campaign names for the own result
  let campaignNames: Record<string, string> = {}
  if (ownRes.data?.campaign_id) {
    const { data: camp } = await sb
      .from('campaigns')
      .select('id, name')
      .eq('id', ownRes.data.campaign_id)
      .single()
    if (camp) campaignNames[camp.id] = camp.name
  }

  if (ownRes.data) {
    return NextResponse.json({
      status: 'own',
      influencer: {
        ...ownRes.data,
        campaign_name: ownRes.data.campaign_id ? campaignNames[ownRes.data.campaign_id] : null,
      },
      // Also pass platform data if available so the card can show richer info
      platformData: platformRes.data || null,
    })
  }

  if (platformRes.data) {
    return NextResponse.json({
      status: 'platform',
      platformData: platformRes.data,
    })
  }

  return NextResponse.json({ status: 'new' })
}
