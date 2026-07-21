// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/links.ts                                                   │
// │                                                                            │
// │ Resolves a redirect slug to its link + partner data, cached in Cloudflare  │
// │ KV. On a warm cache this removes 2-3 Postgres queries from every           │
// │ /r/[slug] hit — the single biggest reduction in DB query volume, which is  │
// │ what sets the Supabase compute tier.                                       │
// │                                                                            │
// │ Slug namespaces, resolved in order:                                        │
// │   1. tracking_links     — LEGACY. Kept only for deployments that still     │
// │                           have that table/view; skipped automatically      │
// │                           when it isn't there.                             │
// │   2. influencers / affiliates / publications — by `redirect_slug`          │
// │   3. whatsapp_campaigns — broadcast campaign links                         │
// │   4. cart_sequence_steps — cart-abandonment message links                  │
// │                                                                            │
// │ ── Fix in this revision (M4) ─────────────────────────────────────────────│
// │ Resolution started and ended at `tracking_links`, which does not exist in  │
// │ the live schema — so every influencer, affiliate and publication link      │
// │ resolved to NOTHING (PostgREST errors the query; the error was discarded   │
// │ and the row read as "not found"), and every cold-cache cart click paid for │
// │ a guaranteed-failing round trip first. Those slugs actually live on        │
// │ `influencers.redirect_slug`, `affiliates.redirect_slug` and                │
// │ `publications.redirect_slug` — which is also what attributeSale() matches  │
// │ mk_slug against. They are read directly now, and the legacy table is       │
// │ probed at most once per isolate.                                           │
// └──────────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'
import { cacheGet, cacheSet, cacheDel } from './cache'

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

// Per-isolate memo. `undefined` = not probed yet, false = the table isn't in
// this database, so stop asking. (Postgres/PostgREST report a missing relation
// as 42P01 / PGRST205 / PGRST202.)
let trackingLinksAvailable: boolean | undefined

const EMPTY = {
  influencerId: null, publicationId: null, affiliateId: null,
  campaignId: null, partnerName: '', destinationUrl: '',
  isWhatsapp: false, discountCode: null, shopDomain: null, cartStepNo: null,
}

// Shared: look up the client's myshopify domain when a code needs routing.
async function shopDomainFor(clientId: string | null): Promise<string | null> {
  if (!clientId) return null
  const sb = getSupabaseAdmin()
  const { data } = await sb.from('clients').select('shopify_domain').eq('id', clientId).maybeSingle()
  return data?.shopify_domain || null
}

// 1) Legacy `tracking_links` table/view, if this deployment has one.
async function fromTrackingLinks(slug: string): Promise<ResolvedLink | null> {
  if (trackingLinksAvailable === false) return null
  const sb = getSupabaseAdmin()

  const { data: link, error } = await sb
    .from('tracking_links').select('*').eq('slug', slug).maybeSingle()

  if (error) {
    const code = String((error as any).code || '')
    const msg = String((error as any).message || '')
    if (code === '42P01' || code.startsWith('PGRST2') || /schema cache|does not exist/i.test(msg)) {
      trackingLinksAvailable = false
    }
    return null
  }
  trackingLinksAvailable = true
  if (!link) return null

  const channel = link.influencer_id ? 'influencer'
    : link.publication_id ? 'seo'
    : link.affiliate_id ? 'affiliate'
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

  return {
    ...EMPTY,
    found: true,
    clientId: link.client_id,
    influencerId: link.influencer_id || null,
    publicationId: link.publication_id || null,
    affiliateId: link.affiliate_id || null,
    campaignId: link.campaign_id || null,
    channel,
    partnerName,
    destinationUrl: link.destination_url || '',
    discountCode,
    // Only Shopify-connected clients can apply a /discount session URL, and we
    // only need the domain when there's actually a code to route through.
    shopDomain: discountCode ? await shopDomainFor(link.client_id) : null,
  }
}

// 2) The real home of partner slugs: `redirect_slug` on each partner table.
//    Inactive partners still resolve — a link already in the wild should keep
//    landing the visitor on the store rather than 404-ing.
async function fromPartnerTables(slug: string): Promise<ResolvedLink | null> {
  const sb = getSupabaseAdmin()

  const [inf, aff, pub] = await Promise.all([
    sb.from('influencers')
      .select('id, client_id, campaign_id, name, destination_url, discount_code')
      .eq('redirect_slug', slug).maybeSingle(),
    sb.from('affiliates')
      .select('id, client_id, campaign_id, name, destination_url, discount_code')
      .eq('redirect_slug', slug).maybeSingle(),
    sb.from('publications')
      .select('id, client_id, campaign_id, publication_name, destination_url')
      .eq('redirect_slug', slug).maybeSingle(),
  ])

  if (inf.data) {
    const d = inf.data
    return {
      ...EMPTY,
      found: true,
      clientId: d.client_id,
      influencerId: d.id,
      campaignId: d.campaign_id || null,
      channel: 'influencer',
      partnerName: d.name || '',
      destinationUrl: d.destination_url || '',
      discountCode: d.discount_code || null,
      shopDomain: d.discount_code ? await shopDomainFor(d.client_id) : null,
    }
  }

  if (aff.data) {
    const d = aff.data
    return {
      ...EMPTY,
      found: true,
      clientId: d.client_id,
      affiliateId: d.id,
      campaignId: d.campaign_id || null,
      channel: 'affiliate',
      partnerName: d.name || '',
      destinationUrl: d.destination_url || '',
      discountCode: d.discount_code || null,
      shopDomain: d.discount_code ? await shopDomainFor(d.client_id) : null,
    }
  }

  if (pub.data) {
    const d = pub.data
    return {
      ...EMPTY,
      found: true,
      clientId: d.client_id,
      publicationId: d.id,
      campaignId: d.campaign_id || null,
      channel: 'seo',
      partnerName: d.publication_name || '',
      destinationUrl: d.destination_url || '',
    }
  }

  return null
}

// 3) WhatsApp broadcast campaign links.
async function fromWhatsappCampaign(slug: string): Promise<ResolvedLink | null> {
  const sb = getSupabaseAdmin()

  // `discount_code` / `destination_url` are optional on whatsapp_campaigns
  // depending on when the schema was migrated. PostgREST errors the WHOLE
  // query on an unknown column, which would take out campaign links
  // entirely — so try the rich select and fall back to the guaranteed one.
  let wa: any = null
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
  if (!wa) return null

  const discountCode = wa.discount_code || null
  return {
    ...EMPTY,
    found: true,
    clientId: wa.client_id,
    campaignId: wa.campaign_id || null,
    channel: 'whatsapp',
    destinationUrl: wa.destination_url || '',
    isWhatsapp: true,
    discountCode,
    shopDomain: discountCode ? await shopDomainFor(wa.client_id) : null,
  }
}

// 4) Cart-abandonment step links. The redirect route strips the `.<cartId>`
//    suffix before calling in, and uses it to look up that shopper's own
//    recovery_url — so there is deliberately no fixed destination here.
async function fromCartStep(slug: string): Promise<ResolvedLink | null> {
  const sb = getSupabaseAdmin()
  const { data: step } = await sb
    .from('cart_sequence_steps')
    .select('client_id, step_no, coupon_code, tracking_slug')
    .eq('tracking_slug', slug).maybeSingle()
  if (!step) return null

  return {
    ...EMPTY,
    found: true,
    clientId: step.client_id,
    channel: 'cart',
    destinationUrl: '',
    isWhatsapp: true,
    discountCode: step.coupon_code || null,
    // Always needed here: even without a coupon, the store domain is the
    // fallback destination when a cart's recovery_url has gone missing.
    shopDomain: await shopDomainFor(step.client_id),
    cartStepNo: step.step_no,
  }
}

export async function resolveLink(slug: string): Promise<ResolvedLink | null> {
  if (!slug) return null
  const cached = await cacheGet<ResolvedLink>(key(slug))
  if (cached) return cached

  const resolved =
    (await fromTrackingLinks(slug))
    || (await fromPartnerTables(slug))
    || (await fromWhatsappCampaign(slug))
    || (await fromCartStep(slug))

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
