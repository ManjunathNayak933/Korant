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
    if (link.influencer_id) {
      const { data } = await sb.from('influencers')
        .select('name').eq('id', link.influencer_id).single()
      partnerName = data?.name || ''
    } else if (link.affiliate_id) {
      const { data } = await sb.from('affiliates')
        .select('name').eq('id', link.affiliate_id).single()
      partnerName = data?.name || ''
    } else if (link.publication_id) {
      const { data } = await sb.from('publications')
        .select('publication_name').eq('id', link.publication_id).single()
      partnerName = data?.publication_name || ''
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
