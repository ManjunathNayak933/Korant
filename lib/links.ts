import { getSupabaseAdmin } from './supabase'
import { cacheGet, cacheSet, cacheDel } from './cache'

// Resolves a redirect slug to its link + partner data, cached in Cloudflare KV.
// On a warm cache this removes the tracking_links lookup AND the partner-name
// lookup (2-3 Postgres queries) from every /r/[slug] hit — the single biggest
// reduction in DB query volume, which is what sets the Supabase compute tier.
//
// Three slug namespaces are resolved, in order:
//   1. tracking_links      — influencer / affiliate / publication links
//   2. whatsapp_campaigns  — broadcast campaign links
//   3. cart_sequence_steps — cart-abandonment message links
//
// (3) previously resolved to NOTHING, so every cart-recovery CTA 500'd on a
// relative redirect. Cart slugs may carry a per-cart suffix, `<slug>.<cartId>`,
// which the redirect route strips before calling this and uses to look up that
// shopper's own recovery_url.

export interface ResolvedLink {
  found: boolean
  clientId: string | null
  influencerId: string | null
  publicationId: string | null
  affiliateId: string | null
  campaignId: string | null
  channel: string          // influencer | seo | affiliate | whatsapp | cart | direct
  partnerName: string
  destinationUrl: string
  isWhatsapp: boolean
  // The partner's checkout discount code (influencer / affiliate / cart step),
  // if any. When present, the redirect routes through Shopify's
  // /discount/<code> URL so the discount sticks to the checkout SESSION and
  // survives cart-bypassing checkouts ("Buy it now", Shop Pay express).
  // null for code-less partners.
  discountCode: string | null
  // The client's myshopify domain, used to build the /discount fallback URL when
  // the destination is relative. null when the client isn't Shopify-connected.
  shopDomain: string | null
  // Cart-abandonment only: the step this slug belongs to, so the redirect can
  // resolve the individual cart's recovery_url.
  cartStepNo: number | null
}

const TTL_SECONDS = 600 // 10 min. Lower if you edit destinations often.
const key = (slug: string) => `lnk:${slug}`

// Shared: look up the client's myshopify domain when a code needs routing.
async function shopDomainFor(clientId: string | null): Promise<string | null> {
  if (!clientId) return null
  const sb = getSupabaseAdmin()
  const { data } = await sb.from('clients').select('shopify_domain').eq('id', clientId).single()
  return data?.shopify_domain || null
}

export async function resolveLink(slug: string): Promise<ResolvedLink | null> {
  const cached = await cacheGet<ResolvedLink>(key(slug))
  if (cached) return cached

  const sb = getSupabaseAdmin()

  const { data: link } = await sb
    .from('tracking_links').select('*').eq('slug', slug).maybeSingle()

  let resolved: ResolvedLink | null = null

  if (link) {
    const channel = link.influencer_id  ? 'influencer'
      : link.publication_id ? 'seo'
      : link.affiliate_id   ? 'affiliate'
      : 'direct'

    let partnerName = ''
    let discountCode: string | null = null
    if (link.influencer_id) {
      const { data } = await sb.from('influencers')
        .select('name, discount_code').eq('id', link.influencer_id).maybeSingle()
      partnerName = data?.name || ''
      discountCode = data?.discount_code || null
    } else if (link.affiliate_id) {
      const { data } = await sb.from('affiliates')
        .select('name, discount_code').eq('id', link.affiliate_id).maybeSingle()
      partnerName = data?.name || ''
      discountCode = data?.discount_code || null
    } else if (link.publication_id) {
      const { data } = await sb.from('publications')
        .select('publication_name').eq('id', link.publication_id).maybeSingle()
      partnerName = data?.publication_name || ''
    }

    // Only Shopify-connected clients can apply a /discount session URL, and we
    // only need the domain when there's actually a code to route through. One
    // extra cold-cache read (this whole object is KV-cached for 10 min).
    const shopDomain = discountCode ? await shopDomainFor(link.client_id) : null

    resolved = {
      found: true,
      clientId:       link.client_id,
      influencerId:   link.influencer_id  || null,
      publicationId:  link.publication_id || null,
      affiliateId:    link.affiliate_id   || null,
      campaignId:     link.campaign_id    || null,
      channel,
      partnerName,
      destinationUrl: link.destination_url || '',
      isWhatsapp:     false,
      discountCode,          // BUG FIX: these two were computed above and then
      shopDomain,            // dropped from the returned object entirely.
      cartStepNo:     null,
    }
  } else {
    // `discount_code` / `destination_url` are optional on whatsapp_campaigns
    // depending on when the schema was migrated. PostgREST errors the WHOLE
    // query on an unknown column, which would take out campaign links
    // entirely — so try the rich select and fall back to the guaranteed one.
    let wa: any = null
    {
      const rich = await sb.from('whatsapp_campaigns')
        .select('client_id, tracking_slug, campaign_id, discount_code, destination_url')
        .eq('tracking_slug', slug).maybeSingle()
      if (!rich.error) {
        wa = rich.data
      } else {
        const lean = await sb.from('whatsapp_campaigns')
          .select('client_id, tracking_slug, campaign_id')
          .eq('tracking_slug', slug).maybeSingle()
        wa = lean.data
      }
    }

    if (wa) {
      const discountCode = wa.discount_code || null
      resolved = {
        found: true,
        clientId:       wa.client_id,
        influencerId:   null,
        publicationId:  null,
        affiliateId:    null,
        campaignId:     wa.campaign_id || null,
        channel:        'whatsapp',
        partnerName:    '',
        destinationUrl: wa.destination_url || '',
        isWhatsapp:     true,
        discountCode,
        shopDomain:     discountCode ? await shopDomainFor(wa.client_id) : null,
        cartStepNo:     null,
      }
    } else {
      // Cart-abandonment step slug.
      const { data: step } = await sb
        .from('cart_sequence_steps')
        .select('client_id, step_no, coupon_code, tracking_slug')
        .eq('tracking_slug', slug).maybeSingle()

      if (step) {
        const discountCode = step.coupon_code || null
        resolved = {
          found: true,
          clientId:       step.client_id,
          influencerId:   null,
          publicationId:  null,
          affiliateId:    null,
          campaignId:     null,
          channel:        'cart',
          partnerName:    '',
          // No fixed destination — the redirect route substitutes the shopper's
          // own cart recovery_url. Falls back to the store URL if unavailable.
          destinationUrl: '',
          isWhatsapp:     true,
          discountCode,
          shopDomain:     await shopDomainFor(step.client_id),
          cartStepNo:     step.step_no,
        }
      }
    }
  }

  // Only cache hits. A miss stays uncached so a newly-created link resolves
  // immediately on its first click.
  if (resolved) await cacheSet(key(slug), resolved, TTL_SECONDS)
  return resolved
}

// Call this from the tracking-link / partner update endpoints so an edited
// destination or renamed partner propagates instantly instead of waiting TTL.
export async function invalidateLink(slug: string): Promise<void> {
  if (!slug) return
  await cacheDel(key(slug))
}
