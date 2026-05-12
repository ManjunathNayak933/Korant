export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  generateVisitorId,
  getVisitorCookie,
  buildVisitorCookie,
  detectEntrySource,
  recordTouchpoint,
} from '@/lib/visitor'

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const slug = params.slug
  const sb   = getSupabaseAdmin()

  // Look up tracking link
  const { data: link } = await sb
    .from('tracking_links')
    .select('*')
    .eq('slug', slug)
    .single()

  // Fallback: check whatsapp_campaigns tracking_slug
  let waLink: any = null
  if (!link) {
    const { data: wa } = await sb
      .from('whatsapp_campaigns')
      .select('client_id, tracking_slug, variable_map')
      .eq('tracking_slug', slug)
      .single()
    waLink = wa
  }

  const destination = link?.destination_url || waLink ? null : null

  // Get or create visitor ID
  let visitorId = getVisitorCookie(request)
  const isNewVisitor = !visitorId
  if (!visitorId) visitorId = generateVisitorId()

  const entrySource = detectEntrySource(request)
  const clientId    = link?.client_id || waLink?.client_id
  const ip          = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''

  if (clientId) {
    // Determine channel from link type
    const channel = link?.influencer_id ? 'influencer'
      : link?.publication_id ? 'seo'
      : link?.affiliate_id   ? 'affiliate'
      : waLink               ? 'whatsapp'
      : 'direct'

    // Get partner details
    let partnerName = ''
    if (link?.influencer_id) {
      const { data: inf } = await sb.from('influencers').select('name').eq('id', link.influencer_id).single()
      partnerName = inf?.name || ''
    } else if (link?.affiliate_id) {
      const { data: aff } = await sb.from('affiliates').select('name').eq('id', link.affiliate_id).single()
      partnerName = aff?.name || ''
    } else if (link?.publication_id) {
      const { data: pub } = await sb.from('publications').select('publication_name').eq('id', link.publication_id).single()
      partnerName = pub?.publication_name || ''
    }

    // Record journey touchpoint
    const { journeyId, touchNumber, isNew } = await recordTouchpoint({
      clientId,
      visitorId,
      channel,
      partnerId:    link?.influencer_id || link?.affiliate_id || link?.publication_id || null,
      partnerName,
      campaignId:   link?.campaign_id || waLink?.campaign_id || null,
      eventType:    'click',
      entrySource,
      isReturnVisit: !isNew,
    })

    // Record click event (existing system)
    await sb.from('events').insert({
      client_id:       clientId,
      type:            'click',
      influencer_id:   link?.influencer_id  || null,
      publication_id:  link?.publication_id || null,
      affiliate_id:    link?.affiliate_id   || null,
      campaign_id:     link?.campaign_id    || null,
      timestamp:       new Date().toISOString(),
      city:            request.headers.get('cf-ipcity')     || null,
      country:         request.headers.get('cf-ipcountry')  || null,
      lat:             request.headers.get('cf-iplatitude')  ? parseFloat(request.headers.get('cf-iplatitude')!) : null,
      lon:             request.headers.get('cf-iplongitude') ? parseFloat(request.headers.get('cf-iplongitude')!) : null,
      referrer:        request.headers.get('referer') || null,
      platform:        request.headers.get('sec-ch-ua-platform') || null,
      // Journey fields
      visitor_id:      visitorId,
      journey_id:      journeyId,
      touch_number:    touchNumber,
      is_return_visit: !isNew,
      first_channel:   channel,
      entry_source:    entrySource,
    })
  }

  // Build redirect response
  const destUrl = link?.destination_url || '/'
  const res = NextResponse.redirect(destUrl, 302)

  // Set visitor cookie (180 days if new, refresh if existing)
  if (isNewVisitor) {
    res.headers.set('Set-Cookie', buildVisitorCookie(visitorId))
  }

  return res
}