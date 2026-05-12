import { getSupabaseAdmin } from './supabase'

export function generateVisitorId(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function generateJourneyId(): string {
  return `j_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function getVisitorCookie(request: Request): string | null {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/kv_id=([a-f0-9]{32})/)
  return match ? match[1] : null
}

export function buildVisitorCookie(visitorId: string): string {
  const maxAge = 90 * 24 * 60 * 60 // 90 days
  return `kv_id=${visitorId}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`
}

export function detectEntrySource(request: Request): string {
  const referrer = request.headers.get('referer') || ''
  if (!referrer || referrer === '') return 'direct'
  try {
    const url = new URL(referrer)
    const host = url.hostname.toLowerCase()
    if (host.includes('google') || host.includes('bing') || host.includes('yahoo') || host.includes('duckduckgo')) return 'organic_search'
    if (host.includes('instagram') || host.includes('facebook') || host.includes('twitter') || host.includes('x.com') || host.includes('linkedin') || host.includes('youtube') || host.includes('tiktok')) return 'social'
    if (host.includes('mail') || host.includes('gmail') || host.includes('outlook') || host.includes('yahoo')) return 'email'
    return 'referral'
  } catch { return 'direct' }
}

export async function recordTouchpoint(params: {
  clientId: string
  visitorId: string
  channel: string
  partnerId?: string
  partnerName?: string
  campaignId?: string
  campaignName?: string
  eventType: string
  entrySource: string
  isReturnVisit: boolean
}): Promise<{ journeyId: string; touchNumber: number; isNew: boolean }> {
  const sb = getSupabaseAdmin()

  // Get or create first touch record
  const { data: existing } = await sb
    .from('visitor_first_touch')
    .select('*')
    .eq('client_id', params.clientId)
    .eq('visitor_id', params.visitorId)
    .single()

  const isNew = !existing
  let journeyId: string
  let touchNumber: number

  if (isNew) {
    journeyId = generateJourneyId()
    touchNumber = 1
    await sb.from('visitor_first_touch').insert({
      client_id:        params.clientId,
      visitor_id:       params.visitorId,
      first_channel:    params.channel,
      first_partner_id: params.partnerId || null,
      first_campaign_id: params.campaignId || null,
      total_visits:     1,
      total_channels:   1,
    })
  } else {
    // Get latest journey for this visitor
    const { data: lastTouch } = await sb
      .from('journey_touchpoints')
      .select('journey_id, touch_number')
      .eq('client_id', params.clientId)
      .eq('visitor_id', params.visitorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    journeyId = lastTouch?.journey_id || generateJourneyId()
    touchNumber = (lastTouch?.touch_number || 0) + 1

    // Update last seen and totals
    const daysSinceFirst = Math.floor(
      (Date.now() - new Date(existing.first_seen_at).getTime()) / 86400000
    )
    await sb.from('visitor_first_touch').update({
      last_seen_at:   new Date().toISOString(),
      total_visits:   (existing.total_visits || 1) + 1,
    }).eq('client_id', params.clientId).eq('visitor_id', params.visitorId)
  }

  // Record the touchpoint
  const daysSinceFirst = isNew ? 0 : Math.floor(
    (Date.now() - new Date(existing!.first_seen_at).getTime()) / 86400000
  )

  await sb.from('journey_touchpoints').insert({
    client_id:      params.clientId,
    visitor_id:     params.visitorId,
    journey_id:     journeyId,
    touch_number:   touchNumber,
    channel:        params.channel,
    partner_id:     params.partnerId || null,
    partner_name:   params.partnerName || null,
    campaign_id:    params.campaignId || null,
    campaign_name:  params.campaignName || null,
    event_type:     params.eventType,
    entry_source:   params.entrySource,
    days_since_first: daysSinceFirst,
  })

  return { journeyId, touchNumber, isNew }
}

export async function markVisitorConverted(clientId: string, visitorId: string) {
  const sb = getSupabaseAdmin()
  await sb.from('visitor_first_touch').update({
    converted: true,
    converted_at: new Date().toISOString(),
  }).eq('client_id', clientId).eq('visitor_id', visitorId)
}