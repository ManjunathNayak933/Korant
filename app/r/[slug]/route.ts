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
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const sb = getSupabaseAdmin()

  const { data: link } = await sb
    .from('tracking_links').select('*').eq('slug', slug).single()

  let waLink: any = null
  if (!link) {
    const { data: wa } = await sb
      .from('whatsapp_campaigns').select('client_id, tracking_slug, campaign_id').eq('tracking_slug', slug).single()
    waLink = wa
  }

  let visitorId = getVisitorCookie(request)
  const isNewVisitor = !visitorId
  if (!visitorId) visitorId = generateVisitorId()

  const entrySource = detectEntrySource(request)
  const clientId = link?.client_id || waLink?.client_id

  if (clientId) {
    const channel = link?.influencer_id  ? 'influencer'
      : link?.publication_id ? 'seo'
      : link?.affiliate_id   ? 'affiliate'
      : waLink               ? 'whatsapp'
      : 'direct'

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

    const touchResult = await recordTouchpoint({
      clientId,
      visitorId,
      channel,
      partnerId:     link?.influencer_id || link?.affiliate_id || link?.publication_id || null,
      partnerName,
      campaignId:    link?.campaign_id || waLink?.campaign_id || null,
      eventType:     'click',
      entrySource,
      isReturnVisit: !isNewVisitor,
    })

    await sb.from('events').insert({
      client_id:       clientId,
      type:            'click',
      influencer_id:   link?.influencer_id  || null,
      publication_id:  link?.publication_id || null,
      affiliate_id:    link?.affiliate_id   || null,
      campaign_id:     link?.campaign_id    || null,
      timestamp:       new Date().toISOString(),
      city:            request.headers.get('cf-ipcity')      || null,
      country:         request.headers.get('cf-ipcountry')   || null,
      lat:             request.headers.get('cf-iplatitude')  ? parseFloat(request.headers.get('cf-iplatitude')!) : null,
      lon:             request.headers.get('cf-iplongitude') ? parseFloat(request.headers.get('cf-iplongitude')!) : null,
      referrer:        request.headers.get('referer')        || null,
      visitor_id:      visitorId,
      journey_id:      touchResult.journeyId,
      touch_number:    touchResult.touchNumber,
      is_return_visit: !isNewVisitor,
      first_channel:   channel,
      entry_source:    entrySource,
    })
  }

  const destUrl = link?.destination_url || '/'
  const res = NextResponse.redirect(destUrl, 302)
  if (isNewVisitor) res.headers.set('Set-Cookie', buildVisitorCookie(visitorId))
  return res
}