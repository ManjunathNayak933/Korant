// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/r/[slug]/route.ts                                          │
// │                                                                            │
// │ The click redirect. Every tracking link in the product lands here:         │
// │ influencer links, affiliate links, WhatsApp broadcast links, and           │
// │ cart-recovery links. Resolves the slug, sends the visitor where they       │
// │ should go, and logs the click in the background.                           │
// └──────────────────────────────────────────────────────────────────────────┘
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

// NextResponse.redirect() runs the URL through `new URL()` and THROWS on a
// relative path ("URL is malformed \"/\"" — Next E61). The old code fell back
// to '/' for any unresolved slug, so every unknown link returned a 500 instead
// of a redirect. Everything below funnels through this: absolute in, or the
// app's own base URL as a last resort.
function safeAbsolute(dest: string, base: string): string {
  const b = base || 'https://www.microkorant.in'
  if (!dest) return b
  try { return new URL(dest).toString() } catch { /* relative — resolve below */ }
  try { return new URL(dest, b).toString() } catch { return b }
}

// Route a code-bearing click through Shopify's /discount/<code> URL. Shopify
// applies the discount to the visitor's checkout SESSION and then redirects to
// the real destination — so the discount (and thus the order's
// discount_codes[]) survives EVERY checkout path, including the ones that skip
// the cart: "Buy it now" and Shop Pay / wallet express buttons.
function buildShopifyDiscountUrl(dest: string, code: string, shopDomain: string): string {
  const c = encodeURIComponent(code)
  try {
    // Absolute destination → keep the customer on that same storefront origin
    // (works whether it's the custom primary domain or the myshopify domain).
    const u = new URL(dest)
    const redirectTarget = u.pathname + u.search
    return `${u.origin}/discount/${c}?redirect=${encodeURIComponent(redirectTarget)}`
  } catch {
    // Relative/empty destination → fall back to the myshopify domain, which
    // serves /discount and forwards to the store's primary domain.
    const path = dest && dest.startsWith('/') ? dest : '/'
    return `https://${shopDomain}/discount/${c}?redirect=${encodeURIComponent(path)}`
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await context.params
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ''

  // Cart-abandonment links carry a per-cart suffix: `<step-slug>.<cartId>`.
  // Everything before the first dot is the slug we resolve; the remainder
  // identifies the individual shopper's cart.
  const dot = rawSlug.indexOf('.')
  const slug = dot > 0 ? rawSlug.slice(0, dot) : rawSlug
  const cartId = dot > 0 ? rawSlug.slice(dot + 1) : null

  // 1 KV read on warm cache (was 2-3 Postgres queries)
  const link = await resolveLink(slug)

  let visitorId = getVisitorCookie(request)
  const isNewVisitor = !visitorId
  if (!visitorId) visitorId = generateVisitorId()

  // For a cart link, the destination is THAT SHOPPER'S OWN recovery URL — the
  // Shopify checkout-resume link captured at intake. Previously the message
  // only ever carried a static per-step slug with no destination at all, so
  // nobody was ever returned to their cart.
  let baseDest = link?.destinationUrl || ''
  if (link?.found && link.channel === 'cart' && cartId) {
    const sb = getSupabaseAdmin()
    const { data: cart } = await sb
      .from('abandoned_carts')
      .select('recovery_url, client_id')
      .eq('id', cartId).eq('client_id', link.clientId).maybeSingle()
    if (cart?.recovery_url) baseDest = cart.recovery_url
  }
  // Still nothing? Send them to the storefront rather than a dead end.
  if (!baseDest && link?.shopDomain) baseDest = `https://${link.shopDomain}`

  const destUrl = (link?.found && link.discountCode && link.shopDomain)
    ? buildShopifyDiscountUrl(baseDest, link.discountCode, link.shopDomain)
    : safeAbsolute(baseDest, base)

  const res = NextResponse.redirect(safeAbsolute(destUrl, base), 302)

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

    // Mark the click on the cart message so the funnel can show click-through
    // per step. Best-effort, never blocks the redirect.
    if (link.channel === 'cart' && cartId && link.cartStepNo) {
      background(
        Promise.resolve(
          sb.from('cart_messages')
            .update({ clicked_at: new Date().toISOString() })
            .eq('cart_id', cartId).eq('step_no', link.cartStepNo).is('clicked_at', null)
        ).then(() => {}).catch(() => {})
      )
    }
  }

  return res
}
