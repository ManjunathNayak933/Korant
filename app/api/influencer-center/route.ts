export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

import { VALID_INDUSTRIES, INDUSTRY_LABELS } from '@/lib/industries'
import { isProClient, platformHasEnoughData } from '@/lib/planLimits'

export async function GET(request: NextRequest) {
  const role   = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!

  if (role !== 'client' && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Pro plan gate — admin bypasses
  if (role === 'client') {
    const [pro, hasData] = await Promise.all([isProClient(userId), platformHasEnoughData()])
    if (!pro) return NextResponse.json({ error: 'pro_required' }, { status: 403 })
    if (!hasData) return NextResponse.json({ error: 'insufficient_data' }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const platform  = searchParams.get('platform')
  const industry  = searchParams.get('category')
  const minRev    = parseFloat(searchParams.get('minRevenue') || '0')
  const minClicks = parseInt(searchParams.get('minClicks') || '0')
  const sortBy    = searchParams.get('sortBy') || 'avg_clicks_per_content'
  const page      = parseInt(searchParams.get('page') || '1')
  const limit     = 24

  const sb = getSupabaseAdmin()

  let query = sb
    .from('influencer_center')
    .select('handle, platform, name, social_url, total_clicks, total_revenue, total_sales, avg_clicks_per_content, brand_count, best_fit_category, content_count')
    .eq('meets_threshold', true)

  if (platform) query = query.eq('platform', platform)
  if (industry && VALID_INDUSTRIES.includes(industry)) query = query.eq('best_fit_category', industry)
  if (minRev > 0)    query = query.gte('total_revenue', minRev)
  if (minClicks > 0) query = query.gte('avg_clicks_per_content', minClicks)

  const validSorts = ['avg_clicks_per_content', 'total_revenue', 'brand_count']
  const safeSort = validSorts.includes(sortBy) ? sortBy : 'avg_clicks_per_content'
  query = query.order(safeSort, { ascending: false }).range((page - 1) * limit, page * limit - 1)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get distinct industries actually present in the data (only show populated ones)
  const { data: cats } = await sb
    .from('influencer_center')
    .select('best_fit_category')
    .eq('meets_threshold', true)
    .not('best_fit_category', 'is', null)

  const presentIndustries = [...new Set((cats || []).map((c: any) => c.best_fit_category))]
    .filter(v => VALID_INDUSTRIES.includes(v))
    .sort((a, b) => (INDUSTRY_LABELS[a] || a).localeCompare(INDUSTRY_LABELS[b] || b))
    .map(v => ({ value: v, label: INDUSTRY_LABELS[v] || v }))

  // Add label to each profile's best_fit_category
  const profiles = (data || []).map((p: any) => ({
    ...p,
    best_fit_category: p.best_fit_category || null,
    best_fit_label: p.best_fit_category ? (INDUSTRY_LABELS[p.best_fit_category] || p.best_fit_category) : null,
  }))

  return NextResponse.json({ profiles, categories: presentIndustries, page, limit })
}
