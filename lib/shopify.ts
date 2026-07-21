import { getSupabaseAdmin } from './supabase'

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/shopify.ts                                                 │
// └──────────────────────────────────────────────────────────────────────────┘
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
  // handler dedupes on order_id, and recoverCartsForOrder() dedupes on
  // recovered_order_id, so nothing is counted twice.
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
// Abandoned-checkout POLLING via the GraphQL Admin `abandonedCheckouts` query.
// This is the reliable modern path — it covers stores on Checkout
// Extensibility regardless of webhook delivery. Requires the `read_orders`
// scope (already requested at install) and Protected Customer Data approval in
// the Partner dashboard for the customer/address fields.
//
// Fully external checkouts (GoKwik / Razorpay Magic / custom headless) never
// create AbandonedCheckout records in Shopify at all; those integrate through
// the platform-neutral /api/webhook/cart endpoint instead.
// ─────────────────────────────────────────────────────────────────────────────

export interface PolledAbandonedCheckout {
  /**
   * FIX 3: the CANONICAL id — the checkout's numeric Shopify id. Both the
   * CHECKOUTS_* webhook (`checkout.id`) and this poll (the numeric part of the
   * GraphQL gid) see the same value, so keying carts on it makes the two paths
   * converge on ONE row.
   *
   * It used to be `tokenFromRecoveryUrl(abandonedCheckoutUrl)`, which on
   * Checkout Extensibility stores is the `cn` token — a DIFFERENT string from
   * the REST `checkout.token` the webhook stored. Neither side recognised the
   * other's id, so every CE-store cart existed twice and the shopper got two
   * of every message.
   */
  externalId: string
  /** Same numeric id, kept as a named field for callers that want it explicitly. */
  checkoutId: string | null
  /**
   * The token parsed out of `abandonedCheckoutUrl` (the `cn` token on CE
   * stores, the classic checkout token elsewhere). Passed as an ALTERNATE id so
   * carts stored by an older build — or by a webhook that had no numeric id —
   * are still matched instead of duplicated.
   */
  recoveryToken: string | null
  /** When Shopify says the checkout was created. Used as abandoned_at. */
  createdAt: string | null
  phone: string | null
  email: string | null
  name: string | null
  optedIn: boolean
  /**
   * H3: whether marketing consent was actually OBSERVABLE for this checkout.
   * False for guest checkouts (no customer node) and for the minimal fallback
   * query. `optedIn: false, consentKnown: false` means "we don't know" — the
   * intake must not write that over a cart the webhook opted in.
   */
  consentKnown: boolean
  totalPrice: number
  currency: string
  items: { title?: string; qty?: number }[]
  recoveryUrl: string | null
}

// Extract the checkout token from an abandonedCheckoutUrl
// (…/checkouts/<token>/recover) so polled carts dedupe against carts already
// captured by the CHECKOUTS_* webhooks, which use checkout.token as external_id.
// Stores on Checkout Extensibility serve `…/checkouts/cn/<token>/recover`, and
// the old pattern captured the literal `cn` for every one of them — so every
// polled cart shared one external_id, overwrote the same row, and polling died
// once that row completed. Skip the `cn/` segment, and allow `-`/`_` since
// modern tokens aren't strictly alphanumeric.
// FIX 3: exported, because app/api/webhook/shopify-checkout/route.ts has to
// derive the SAME token from the REST payload's `abandoned_checkout_url`. That
// is what lets a webhook find a row the poll already created (and vice versa).
export function tokenFromRecoveryUrl(url: string | null | undefined): string | null {
  const m = String(url || '').match(/\/checkouts\/(?:cn\/)?([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

// Shopify caps this connection at 250 per page; 50 keeps each response small
// enough that a slow store can't time the cron invocation out.
const POLL_PAGE_SIZE = 50
const POLL_MAX_PAGES = 5

// ── FIX 4 ────────────────────────────────────────────────────────────────────
// This used to issue ONE `abandonedCheckouts(first: 25)` call with no sort key
// and no cursor. The connection's default order is oldest-first, and the search
// window is a rolling 24h — so on any store with more than 25 abandoned
// checkouts a day the SAME oldest 25 came back every hour and the newer ones
// (the recoverable ones) were never intaken at all. They only became visible
// once they'd aged out of the window, by which point they were 24h stale.
//
// Now: newest-first, and paged with a cursor until the caller's budget is
// filled. `updatedSinceIso` is supplied by the tick as a high-water mark
// (cart_sequences.last_polled_at) rather than a fixed 24h, so steady-state runs
// only look at the delta and the budget stretches much further.
export async function fetchShopifyAbandonedCheckouts(
  clientId: string,
  updatedSinceIso: string,
  limit = 50
): Promise<PolledAbandonedCheckout[]> {
  const client = await getClientShopify(clientId)
  if (!client) return []

  // H6: the caller (the hourly tick) budgets this — each returned checkout
  // costs further subrequests downstream inside the same cron invocation.
  const want = Math.max(1, Math.trunc(limit) || 1)
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

  // Two axes of graceful degradation, tried in order:
  //   1. customer fields  — identity + SMS consent. Needs Protected Customer
  //      Data approval; without it the whole query errors, so we retry without.
  //   2. sortKey/reverse  — if a future API version renames the enum we still
  //      want carts, just in the old (oldest-first) order.
  // `consentKnown` is false on the minimal query: "we couldn't see consent",
  // NEVER "they declined" (H3).
  const build = (opts: { customer: boolean; sorted: boolean }) => {
    const order = opts.sorted ? ', sortKey: CREATED_AT, reverse: true' : ''
    const custFields = opts.customer
      ? 'customer { firstName lastName email phone smsMarketingConsent { marketingState } }'
      : ''
    return `query Polled($q: String, $n: Int!, $after: String) {
      abandonedCheckouts(first: $n, query: $q, after: $after${order}) {
        nodes { ${core} ${custFields} }
        pageInfo { hasNextPage endCursor }
      } }`
  }

  let customerFieldsAvailable = true
  let sorted = true
  let after: string | null = null
  const nodes: any[] = []

  for (let page = 0; page < POLL_MAX_PAGES && nodes.length < want; page++) {
    const n = Math.min(POLL_PAGE_SIZE, want - nodes.length)
    let conn: any = null

    // Try the richest query first, then peel options off. Only the FIRST page
    // pays for this discovery — the flags persist across pages.
    for (const attempt of [
      { customer: customerFieldsAvailable, sorted },
      { customer: customerFieldsAvailable, sorted: false },
      { customer: false, sorted: false },
    ]) {
      try {
        const data = await shopifyGraphQL(
          client.shopify_domain, client.shopify_token,
          build(attempt), { q: search, n, after }
        )
        conn = data?.abandonedCheckouts
        customerFieldsAvailable = attempt.customer
        sorted = attempt.sorted
        break
      } catch (e) {
        // Last attempt failed too — give up on this client for this tick.
        if (!attempt.customer && !attempt.sorted) {
          console.error('[shopify poll] abandonedCheckouts query failed', { clientId, page, e: String(e) })
        }
      }
    }

    if (!conn) break
    nodes.push(...(conn.nodes || []))
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break
    after = conn.pageInfo.endCursor
  }

  return nodes.map((n: any): PolledAbandonedCheckout => {
    const cust = n.customer || null
    const phone = cust?.phone
      || n.shippingAddress?.phone
      || n.billingAddress?.phone
      || null
    // WhatsApp opt-in ≈ SMS channel consent. STRICT boolean on the enum state —
    // never truthiness of the consent object (that bug opted in decliners).
    const optedIn = String(cust?.smsMarketingConsent?.marketingState || '').toUpperCase() === 'SUBSCRIBED'
    const numericId = gidToNumericId(n.id)
    const recoveryToken = tokenFromRecoveryUrl(n.abandonedCheckoutUrl)
    return {
      // FIX 3: numeric checkout id is the canonical key — it's the one value
      // the CHECKOUTS_* webhook also has. Fall back to the recovery token only
      // when the gid didn't parse.
      externalId: numericId ? String(numericId) : (recoveryToken || ''),
      checkoutId: numericId ? String(numericId) : null,
      recoveryToken,
      createdAt: n.createdAt || null,
      phone,
      email: cust?.email || null,
      name: cust?.firstName ? `${cust.firstName} ${cust.lastName || ''}`.trim() : (n.billingAddress?.name || null),
      optedIn,
      // Only a checkout with a real customer record on the full query tells us
      // anything about consent. A guest checkout tells us nothing.
      consentKnown: customerFieldsAvailable && !!cust,
      totalPrice: parseFloat(n.totalPriceSet?.shopMoney?.amount || '0'),
      currency: n.totalPriceSet?.shopMoney?.currencyCode || 'INR',
      items: (n.lineItems?.nodes || []).map((li: any) => ({ title: li.title, qty: li.quantity })),
      recoveryUrl: n.abandonedCheckoutUrl || null,
    }
  })
}
