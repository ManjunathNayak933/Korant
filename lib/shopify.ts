import { getSupabaseAdmin } from './supabase'

// Shopify Admin GraphQL API. Discounts, webhooks, and abandoned-checkout
// polling all go through GraphQL — the REST Admin API is legacy (Oct 2024) and
// new public apps must be GraphQL-only since April 2025.
//
// NOTE: the `shopify_price_rule_id` column (bigint) stores the numeric part of
// the DiscountCodeNode GID (gid://shopify/DiscountCodeNode/<id>). Function
// names are kept for interface stability with existing callers.
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07' // latest stable

export async function shopifyGraphQL(
  domain: string, token: string, query: string, variables?: Record<string, unknown>
) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL failed: ${res.status} ${JSON.stringify(json.errors || json)}`)
  }
  return json.data
}

function gidToNumericId(gid: string): number {
  const m = String(gid).match(/(\d+)\s*$/)
  return m ? Number(m[1]) : 0
}
function discountGid(id: number | string): string {
  return `gid://shopify/DiscountCodeNode/${id}`
}

export async function getClientShopify(clientId: string) {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('clients')
    .select('shopify_domain, shopify_token')
    .eq('id', clientId)
    .single()
  if (!data?.shopify_domain || !data?.shopify_token) return null
  return data
}

export async function createShopifyDiscountCode(
  clientId: string,
  discountCode: string,
  percentOff: number = 10,
  fixedAmount?: number
): Promise<{ priceRuleId: number; discountCodeId: number } | null> {
  const client = await getClientShopify(clientId)
  if (!client) return null

  try {
    // If the code already exists, return its existing node id (idempotent).
    try {
      const data = await shopifyGraphQL(
        client.shopify_domain, client.shopify_token,
        `query LookupCode($code: String!) {
           codeDiscountNodeByCode(code: $code) { id }
         }`,
        { code: discountCode }
      )
      const existingGid = data?.codeDiscountNodeByCode?.id
      if (existingGid) {
        const numId = gidToNumericId(existingGid)
        return { priceRuleId: numId, discountCodeId: numId }
      }
    } catch { /* not found — proceed to create */ }

    // GraphQL percentage is a fraction (0.1 = 10%); fixed amount is a string.
    const value = (fixedAmount !== undefined && fixedAmount !== null)
      ? { discountAmount: { amount: String(fixedAmount), appliesOnEachItem: false } }
      : { percentage: percentOff / 100 }

    const data = await shopifyGraphQL(
      client.shopify_domain, client.shopify_token,
      `mutation Create($basicCodeDiscount: DiscountCodeBasicInput!) {
         discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
           codeDiscountNode { id }
           userErrors { field message }
         }
       }`,
      {
        basicCodeDiscount: {
          title: `KORANT-${discountCode}`,
          code: discountCode,
          startsAt: new Date().toISOString(),
          customerSelection: { all: true },
          customerGets: { value, items: { all: true } },
          appliesOncePerCustomer: false,
        },
      }
    )

    const payload = data.discountCodeBasicCreate
    if (payload.userErrors?.length) {
      throw new Error(payload.userErrors.map((e: any) => e.message).join('; '))
    }
    const numId = gidToNumericId(payload.codeDiscountNode.id)
    return { priceRuleId: numId, discountCodeId: numId }
  } catch (e) {
    console.error('Shopify discount creation failed:', e)
    return null
  }
}

export async function updateShopifyDiscountCode(
  clientId: string,
  priceRuleId: number,
  newCode: string,
  percentOff: number = 10
): Promise<boolean> {
  const client = await getClientShopify(clientId)
  if (!client) return false

  try {
    const data = await shopifyGraphQL(
      client.shopify_domain, client.shopify_token,
      `mutation Update($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
         discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
           codeDiscountNode { id }
           userErrors { field message }
         }
       }`,
      {
        id: discountGid(priceRuleId),
        basicCodeDiscount: {
          title: `KORANT-${newCode}`,
          code: newCode,
          customerGets: { value: { percentage: percentOff / 100 } },
        },
      }
    )
    const payload = data.discountCodeBasicUpdate
    if (payload.userErrors?.length) {
      console.error('Shopify discount update errors:', payload.userErrors)
      return false
    }
    return true
  } catch (e) {
    console.error('Shopify discount update failed:', e)
    return false
  }
}

export async function deleteShopifyPriceRule(
  clientId: string,
  priceRuleId: number
): Promise<void> {
  const client = await getClientShopify(clientId)
  if (!client) return

  try {
    const data = await shopifyGraphQL(
      client.shopify_domain, client.shopify_token,
      `mutation Delete($id: ID!) {
         discountCodeDelete(id: $id) {
           deletedCodeDiscountId
           userErrors { field message }
         }
       }`,
      { id: discountGid(priceRuleId) }
    )
    const errs = data.discountCodeDelete?.userErrors
    if (errs?.length) console.error('Shopify discount delete errors:', errs)
  } catch (e) {
    console.error('Shopify discount deletion failed:', e)
  }
}

export async function verifyShopifyWebhook(request: Request, secret: string): Promise<boolean> {
  const body = await request.text()
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256')
    || request.headers.get('x-shopify-hmac-sha256')
    || request.headers.get('shopify-hmac-sha256')
    || ''
  if (!hmac) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return computed === hmac
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth-app additions (used by /api/shopify/install + /api/shopify/callback and
// the order webhook handler). These reuse shopifyGraphQL above.
// ─────────────────────────────────────────────────────────────────────────────

// Subscribe the connected app to the order webhooks we care about. Called once,
// right after OAuth, so the customer never sets up a webhook by hand. Safe to
// re-run: Shopify rejects duplicate topic+address subscriptions, which we ignore.
export async function registerShopifyOrderWebhooks(
  domain: string, token: string, callbackUrl: string
): Promise<void> {
  // ORDERS_CREATE is registered alongside ORDERS_PAID to catch orders pushed in
  // ALREADY paid via the Admin API (e.g. a third-party checkout writing the
  // finished order back into Shopify) — those never fire ORDERS_PAID because
  // there's no pending→paid transition. A normal checkout fires both; the
  // handler dedupes on order_id, so no double-count.
  const topics = ['ORDERS_PAID', 'ORDERS_CREATE', 'REFUNDS_CREATE', 'ORDERS_CANCELLED']
  for (const topic of topics) {
    try {
      const data = await shopifyGraphQL(
        domain, token,
        `mutation Sub($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
           webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
             webhookSubscription { id }
             userErrors { field message }
           }
         }`,
        { topic, sub: { callbackUrl, format: 'JSON' } }
      )
      const errs = data?.webhookSubscriptionCreate?.userErrors || []
      if (errs.length) {
        const msg = errs.map((e: any) => e.message).join('; ')
        if (!/taken|already/i.test(msg)) console.error(`Webhook ${topic} error:`, msg)
      }
    } catch (e) {
      console.error(`Webhook ${topic} registration failed:`, e)
    }
  }
}

// Verify an app-registered webhook against the app's client secret. App webhooks
// are signed with SHOPIFY_API_SECRET (one secret for all connected stores), not
// the per-client URL key. `body` is the raw request text; `hmac` is the
// X-Shopify-Hmac-Sha256 header. Base64 to match Shopify's format.
export async function verifyShopifyHmacRaw(
  body: string, hmac: string, secret: string
): Promise<boolean> {
  if (!hmac || !secret) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)))
  // constant-time-ish compare
  if (computed.length !== hmac.length) return false
  let r = 0
  for (let i = 0; i < computed.length; i++) r |= computed.charCodeAt(i) ^ hmac.charCodeAt(i)
  return r === 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Cart-abandonment: subscribe the connected app to CHECKOUT webhooks so
// abandoned carts flow in as they happen (Shopify fires these when a shopper
// reaches checkout and enters details but doesn't pay). Duplicate-topic errors
// are ignored. Called from the OAuth callback.
// ─────────────────────────────────────────────────────────────────────────────
export async function registerShopifyCheckoutWebhooks(
  domain: string, token: string, callbackUrl: string
): Promise<void> {
  const topics = ['CHECKOUTS_CREATE', 'CHECKOUTS_UPDATE']
  for (const topic of topics) {
    try {
      const data = await shopifyGraphQL(
        domain, token,
        `mutation Sub($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
           webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
             webhookSubscription { id }
             userErrors { field message }
           }
         }`,
        { topic, sub: { callbackUrl, format: 'JSON' } }
      )
      const errs = data?.webhookSubscriptionCreate?.userErrors || []
      if (errs.length) {
        const msg = errs.map((e: any) => e.message).join('; ')
        if (!/taken|already/i.test(msg)) console.error(`Webhook ${topic} error:`, msg)
      }
    } catch (e) {
      console.error(`Webhook ${topic} registration failed:`, e)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Abandoned-checkout POLLING via the GraphQL Admin `abandonedCheckouts` query
// (2026-07). This is the reliable modern path — it covers stores on Checkout
// Extensibility regardless of webhook delivery. Requires the `read_orders`
// scope (already requested at install) and Protected Customer Data approval in
// the Partner dashboard for the customer/address fields.
//
// Fully external checkouts (GoKwik / Razorpay Magic / custom headless) never
// create AbandonedCheckout records in Shopify at all; those integrate through
// the platform-neutral /api/webhook/cart endpoint instead.
// ─────────────────────────────────────────────────────────────────────────────

export interface PolledAbandonedCheckout {
  externalId: string
  phone: string | null
  email: string | null
  name: string | null
  optedIn: boolean
  totalPrice: number
  currency: string
  items: { title?: string; qty?: number }[]
  recoveryUrl: string | null
}

// Extract the checkout token from an abandonedCheckoutUrl
// (…/checkouts/<token>/recover) so polled carts dedupe against carts already
// captured by the CHECKOUTS_* webhooks, which use checkout.token as external_id.
function tokenFromRecoveryUrl(url: string | null | undefined): string | null {
  const m = String(url || '').match(/\/checkouts\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}

export async function fetchShopifyAbandonedCheckouts(
  clientId: string,
  updatedSinceIso: string
): Promise<PolledAbandonedCheckout[]> {
  const client = await getClientShopify(clientId)
  if (!client) return []

  const search = `updated_at:>='${updatedSinceIso}'`
  const core = `
    id
    abandonedCheckoutUrl
    createdAt
    updatedAt
    totalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 10) { nodes { title quantity } }
    billingAddress { name phone }
    shippingAddress { phone }`

  // Primary query includes customer identity + SMS marketing consent. If Meta-
  // data fields shift between API versions, fall back to a minimal field set
  // (those carts are stored but not messageable until consent is known).
  const withCustomer = `query Polled($q: String) {
    abandonedCheckouts(first: 50, query: $q) { nodes {
      ${core}
      customer { firstName lastName email phone smsMarketingConsent { marketingState } }
    } } }`
  const minimal = `query Polled($q: String) {
    abandonedCheckouts(first: 50, query: $q) { nodes { ${core} } } }`

  let nodes: any[] = []
  try {
    const data = await shopifyGraphQL(client.shopify_domain, client.shopify_token, withCustomer, { q: search })
    nodes = data?.abandonedCheckouts?.nodes || []
  } catch {
    try {
      const data = await shopifyGraphQL(client.shopify_domain, client.shopify_token, minimal, { q: search })
      nodes = data?.abandonedCheckouts?.nodes || []
    } catch (e) {
      console.error('[shopify poll] abandonedCheckouts query failed', { clientId, e: String(e) })
      return []
    }
  }

  return nodes.map((n: any): PolledAbandonedCheckout => {
    const cust = n.customer || {}
    const phone = cust.phone
      || n.shippingAddress?.phone
      || n.billingAddress?.phone
      || null
    // WhatsApp opt-in ≈ SMS channel consent. STRICT boolean on the enum state —
    // never truthiness of the consent object (that bug opted in decliners).
    const optedIn = String(cust?.smsMarketingConsent?.marketingState || '').toUpperCase() === 'SUBSCRIBED'
    return {
      externalId: tokenFromRecoveryUrl(n.abandonedCheckoutUrl) || gidToNumericId(n.id).toString(),
      phone,
      email: cust.email || null,
      name: cust.firstName ? `${cust.firstName} ${cust.lastName || ''}`.trim() : (n.billingAddress?.name || null),
      optedIn,
      totalPrice: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
      currency: n.totalPriceSet?.shopMoney?.currencyCode || 'INR',
      items: (n.lineItems?.nodes || []).map((li: any) => ({ title: li.title, qty: li.quantity })),
      recoveryUrl: n.abandonedCheckoutUrl || null,
    }
  })
}
