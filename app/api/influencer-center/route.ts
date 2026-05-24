export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Exact industry values from the signup form — used for filter validation
const VALID_INDUSTRIES = [
  'saas',
  'd2c_fashion','d2c_footwear','d2c_jewellery','d2c_bags',
  'd2c_skincare','d2c_haircare','d2c_makeup','d2c_personal_care','d2c_nutrition','d2c_health',
  'd2c_food','d2c_beverages','d2c_organic',
  'd2c_home','d2c_kitchen',
  'd2c_electronics','d2c_sports',
  'd2c_pet','d2c_kids','d2c_gifting',
  'services','edtech','fintech','healthcare','hospitality','real_estate','other',
]

// Human-readable labels matching the signup form optgroups
export const INDUSTRY_LABELS: Record<string, string> = {
  saas: 'SaaS',
  d2c_fashion: 'D2C Fashion & Apparel',
  d2c_footwear: 'D2C Footwear',
  d2c_jewellery: 'D2C Jewellery',
  d2c_bags: 'D2C Bags & Luggage',
  d2c_skincare: 'D2C Skincare',
  d2c_haircare: 'D2C Haircare',
  d2c_makeup: 'D2C Makeup & Cosmetics',
  d2c_personal_care: 'D2C Personal Care & Grooming',
  d2c_nutrition: 'D2C Nutrition & Supplements',
  d2c_health: 'D2C Health & Wellness',
  d2c_food: 'D2C Food & Snacks',
  d2c_beverages: 'D2C Beverages & Drinks',
  d2c_organic: 'D2C Organic & Natural',
  d2c_home: 'D2C Home & Living',
  d2c_kitchen: 'D2C Kitchen & Cookware',
  d2c_electronics: 'D2C Electronics & Gadgets',
  d2c_sports: 'D2C Sports & Fitness',
  d2c_pet: 'D2C Pet Products',
  d2c_kids: 'D2C Kids & Baby',
  d2c_gifting: 'D2C Gifting & Hampers',
  services: 'Services',
  edtech: 'EdTech',
  fintech: 'FinTech',
  healthcare: 'Healthcare',
  hospitality: 'Hospitality & Travel',
  real_estate: 'Real Estate',
  other: 'Other',
}

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'client' && role !== 'admin' && role !== 'agency') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
