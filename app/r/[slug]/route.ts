export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@cloudflare/next-on-pages'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveLink } from '@/lib/links'
import {
  generateVisitorId,
  getVisitorCookie,
  buildVisitorCookie,
  detectEntrySource,
} from '@/lib/visitor'

// Run a promise after the response is sent so the 302 isn't blocked by the
// DB write. Falls back to fire-and-forget if the CF context isn't available.
function background(p: Promise<unknown>) {
  try {
    getRequestContext().ctx.waitUntil(p)
  } catch {
    void p
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params

  // 1 KV read on warm cache (was 2-3 Postgres queries)
  const link = await resolveLink(slug)

  let visitorId = getVisitorCookie(request)
  const isNewVisitor = !visitorId
  if (!visitorId) visitorId = generateVisitorId()

  // Build + return the redirect immediately
  const destUrl = link?.destinationUrl || '/'
  const res = NextResponse.redirect(destUrl, 302)

  const cookies: string[] = []
  if (isNewVisitor) cookies.push(buildVisitorCookie(visitorId))
  if (link?.found) {
    cookies.push(`mk_slug=${slug}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; Secure`)
    const hasFirst = (request.headers.get('cookie') || '').includes('mk_slug_first=')
    if (!hasFirst) {
      cookies.push(`mk_slug_first=${slug}; Path=/; Max-Age=${90 * 24 * 60 * 60}; SameSite=Lax; Secure`)
    }
  }
  for (const c of cookies) res.headers.append('Set-Cookie', c)

  // Track in the background: ONE rpc instead of ~6 sequential round-trips
  if (link?.found && link.clientId) {
    const entrySource = detectEntrySource(request)
    const sb = getSupabaseAdmin()
    const lat = request.headers.get('cf-iplatitude')
    const lon = request.headers.get('cf-iplongitude')

    const write = sb.rpc('record_click', {
      p_client_id:      link.clientId,
      p_visitor_id:     visitorId,
      p_channel:        link.channel,
      p_entry_source:   entrySource,
      p_partner_id:     link.influencerId || link.affiliateId || link.publicationId || null,
      p_partner_name:   link.partnerName,
      p_campaign_id:    link.campaignId,
      p_event_type:     'click',
      p_influencer_id:  link.influencerId,
      p_publication_id: link.publicationId,
      p_affiliate_id:   link.affiliateId,
      p_city:           request.headers.get('cf-ipcity')    || null,
      p_country:        request.headers.get('cf-ipcountry') || null,
      p_lat:            lat ? parseFloat(lat) : null,
      p_lon:            lon ? parseFloat(lon) : null,
      p_referrer:       request.headers.get('referer')      || null,
    })

    background(
      Promise.resolve(write).then(({ error }: any) => {
        if (error) console.error('record_click failed', error)
      })
    )
  }

  return res
}
