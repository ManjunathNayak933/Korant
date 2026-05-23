export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'client' && role !== 'admin' && role !== 'agency') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const platform  = searchParams.get('platform')
  const category  = searchParams.get('category')
  const minRev    = parseFloat(searchParams.get('minRevenue') || '0')
  const minClicks = parseInt(searchParams.get('minClicks') || '0')
  const sortBy    = searchParams.get('sortBy') || 'avg_clicks_per_content'
  const page      = parseInt(searchParams.get('page') || '1')
  const limit     = 24

  const sb = getSupabaseAdmin()

  // Query the view — Supabase treats it like any other table
  let query = sb
    .from('influencer_center')
    .select('handle, platform, name, social_url, total_clicks, total_revenue, total_sales, avg_clicks_per_content, brand_count, best_fit_category, content_count')
    .eq('meets_threshold', true)

  if (platform)      query = query.eq('platform', platform)
  if (category)      query = query.eq('best_fit_category', category)
  if (minRev > 0)    query = query.gte('total_revenue', minRev)
  if (minClicks > 0) query = query.gte('avg_clicks_per_content', minClicks)

  const validSorts = ['avg_clicks_per_content', 'total_revenue', 'brand_count']
  const safeSort = validSorts.includes(sortBy) ? sortBy : 'avg_clicks_per_content'

  query = query
    .order(safeSort, { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get distinct categories for dropdown
  const { data: cats } = await sb
    .from('influencer_center')
    .select('best_fit_category')
    .eq('meets_threshold', true)
    .not('best_fit_category', 'is', null)

  const categories = [...new Set((cats || []).map((c: any) => c.best_fit_category))].sort()

  return NextResponse.json({ profiles: data, categories, page, limit })
}
