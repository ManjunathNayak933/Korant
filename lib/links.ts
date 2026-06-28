import { getSupabaseAdmin } from './supabase'
import { cacheGet, cacheSet, cacheDel } from './cache'

// Resolves a redirect slug to its link + partner data, cached in Cloudflare KV.
// On a warm cache this removes the tracking_links lookup AND the partner-name
// lookup (2-3 Postgres queries) from every /r/[slug] hit — the single biggest
// reduction in DB query volume, which is what sets the Supabase compute tier.

export interface ResolvedLink {
  found: boolean
  clientId: string | null
  influencerId: string | null
  publicationId: string | null
  affiliateId: string | null
  campaignId: string | null
  channel: string          // influencer | seo | affiliate | whatsapp | direct
  partnerName: string
  destinationUrl: string
  isWhatsapp: boolean
  // The partner's checkout discount code (influencer/affiliate), if any. When
  // present, the redirect routes through Shopify's /discount/<code> URL so the
  // discount sticks to the checkout SESSION and survives cart-bypassing
  // checkouts ("Buy it now", Shop Pay express). null for code-less partners.
  discountCode: string | null
  // The client's myshopify domain, used to build the /discount fallback URL when
  // the destination is relative. null when the client isn't Shopify-connected.
  shopDomain: string | null
}

const TTL_SECONDS = 600 // 10 min. Lower if you edit destinations often.
const key = (slug: string) => `lnk:${slug}`

export async function resolveLink(slug: string): Promise<ResolvedLink | null> {
  const cached = await cacheGet<ResolvedLink>(key(slug))
  if (cached) return cached

  const sb = getSupabaseAdmin()

  const { data: link } = await sb
    .from('tracking_links').select('*').eq('slug', slug).single()

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
        .select('name, discount_code').eq('id', link.influencer_id).single()
      partnerName = data?.name || ''
      discountCode = data?.discount_code || null
    } else if (link.affiliate_id) {
      const { data } = await sb.from('affiliates')
        .select('name, discount_code').eq('id', link.affiliate_id).single()
      partnerName = data?.name || ''
      discountCode = data?.discount_code || null
    } else if (link.publication_id) {
      const { data } = await sb.from('publications')
        .select('publication_name').eq('id', link.publication_id).single()
      partnerName = data?.publication_name || ''
    }

    // Only Shopify-connected clients can apply a /discount session URL, and we
    // only need the domain when there's actually a code to route through. One
    // extra cold-cache read (this whole object is KV-cached for 10 min).
    let shopDomain: string | null = null
    if (discountCode) {
      const { data: c } = await sb.from('clients')
        .select('shopify_domain').eq('id', link.client_id).single()
      shopDomain = c?.shopify_domain || null
    }

    resolved = {
      found: true,
      clientId:       link.client_id,
      influencerId:   link.influencer_id  || null,
      publicationId:  link.publication_id || null,
      affiliateId:    link.affiliate_id   || null,
      campaignId:     link.campaign_id    || null,
      channel,
      partnerName,
      destinationUrl: link.destination_url || '/',
      isWhatsapp:     false,
    }
  } else {
    const { data: wa } = await sb
      .from('whatsapp_campaigns')
      .select('client_id, tracking_slug, campaign_id')
      .eq('tracking_slug', slug).single()

    if (wa) {
      resolved = {
        found: true,
        clientId:       wa.client_id,
        influencerId:   null,
        publicationId:  null,
        affiliateId:    null,
        campaignId:     wa.campaign_id || null,
        channel:        'whatsapp',
        partnerName:    '',
        destinationUrl: '/',
        isWhatsapp:     true,
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
  await cacheDel(key(slug))
}
