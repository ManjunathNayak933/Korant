
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { findEntityBySlug, parseGeoFromRequest, parseDeviceBrowser } from '@/lib/tracking'
import { invalidateClientMetrics } from '@/lib/cache'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const slug = (await params).slug
  const sb = getSupabaseAdmin()

  const found = await findEntityBySlug(slug)
  if (!found) {
    return NextResponse.redirect(
      new URL('/', process.env.NEXT_PUBLIC_BASE_URL || 'https://korant.app'), 302
    )
  }

  const { type, entity } = found
  const destination = entity.destination_url.startsWith('http')
    ? entity.destination_url
    : `https://${entity.destination_url}`

  // Cookie-based dedup — 30-min window per browser per slug
  const dedupCookie = request.cookies.get(`mk_c_${slug}`)?.value
  const mkSlugFirst = request.cookies.get('mk_slug_first')?.value

  const response = NextResponse.redirect(destination, { status: 302 })

  // Set last-touch attribution cookie (30d)
  response.cookies.set('mk_slug', slug, {
    httpOnly: false, maxAge: 30 * 24 * 60 * 60, path: '/', sameSite: 'lax',
  })
  // Set first-touch cookie ONCE — never overwrite
  if (!mkSlugFirst) {
    response.cookies.set('mk_slug_first', slug, {
      httpOnly: false, maxAge: 90 * 24 * 60 * 60, path: '/', sameSite: 'lax',
    })
  }

  // Only record click if entity is active AND not a duplicate within 30 mins
  if (entity.is_active && !dedupCookie) {
    const geo = parseGeoFromRequest(request)
    const { device, browser } = parseDeviceBrowser(request)

    // Set dedup cookie
    response.cookies.set(`mk_c_${slug}`, '1', {
      httpOnly: true, maxAge: 30 * 60, path: '/', sameSite: 'lax',
    })

    const eventData: Record<string, unknown> = {
      client_id: entity.client_id,
      campaign_id: entity.campaign_id || null,
      type: 'click',
      attribution_method: 'slug',
      city: geo.city,
      country: geo.country,
      lat: geo.lat,
      lon: geo.lon,
      device,
      browser,
      ip: geo.ip,
      first_touch_slug: mkSlugFirst || slug,
      referrer: request.headers.get('referer') || null,
    }

    if (type === 'influencer') eventData.influencer_id = entity.id
    else if (type === 'publication') eventData.publication_id = entity.id
    else if (type === 'affiliate') eventData.affiliate_id = entity.id

    // Insert event and invalidate metrics cache — both fire together
    try {
      await sb.from('events').insert(eventData)
      // Bust ALL metrics cache entries for this client so overview + channel tabs show fresh data immediately
      await invalidateClientMetrics(entity.client_id)
    } catch {}
  }

  return response
}
