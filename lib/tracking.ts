import { getSupabaseAdmin } from './supabase'

export function generateSlug(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let slug = prefix ? `${prefix}-` : ''
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)]
  }
  return slug
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  // Clean the base
  const clean = base.toLowerCase().replace(/[^a-z0-9-]/g, '')
  // Append a random 6-char suffix — collision probability is ~1 in 2 billion, no loop needed
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${clean}-${suffix}`
}

export async function findEntityBySlug(slug: string) {
  const sb = getSupabaseAdmin()
  // Check influencer
  const { data: influencer } = await sb
    .from('influencers')
    .select('id, client_id, campaign_id, destination_url, is_active, discount_code, name')
    .eq('redirect_slug', slug)
    .single()
  if (influencer) return { type: 'influencer' as const, entity: influencer }

  // Check publication
  const { data: publication } = await sb
    .from('publications')
    .select('id, client_id, campaign_id, destination_url, is_active, name:publication_name')
    .eq('redirect_slug', slug)
    .single()
  if (publication) return { type: 'publication' as const, entity: publication }

  // Check affiliate
  const { data: affiliate } = await sb
    .from('affiliates')
    .select('id, client_id, campaign_id, destination_url, is_active, discount_code, name')
    .eq('redirect_slug', slug)
    .single()
  if (affiliate) return { type: 'affiliate' as const, entity: affiliate }

  return null
}

export function parseGeoFromRequest(req: Request) {
  const headers = req.headers
  return {
    country: headers.get('cf-ipcountry') || null,
    city: headers.get('cf-ipcity') || headers.get('x-vercel-ip-city') || null,
    lat: headers.get('cf-iplatitude') ? parseFloat(headers.get('cf-iplatitude')!) : null,
    lon: headers.get('cf-iplongitude') ? parseFloat(headers.get('cf-iplongitude')!) : null,
    ip: headers.get('cf-connecting-ip') || headers.get('x-forwarded-for') || null,
  }
}

export function parseDeviceBrowser(req: Request) {
  const ua = req.headers.get('user-agent') || ''
  let device = 'desktop'
  if (/mobile|android|iphone|ipad/i.test(ua)) device = 'mobile'
  else if (/tablet/i.test(ua)) device = 'tablet'
  let browser = 'other'
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = 'chrome'
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'safari'
  else if (/firefox/i.test(ua)) browser = 'firefox'
  else if (/edge/i.test(ua)) browser = 'edge'
  return { device, browser }
}
