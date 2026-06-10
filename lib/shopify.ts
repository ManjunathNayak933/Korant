import { getSupabaseAdmin } from './supabase'

// Shopify Admin GraphQL API. The REST PriceRule/DiscountCode resources used
// previously are deprecated by Shopify (removal on the 2026 path), so discount
// management now uses the GraphQL discount mutations.
//
// NOTE: the `shopify_price_rule_id` column (bigint) now stores the numeric part
// of the DiscountCodeNode GID (gid://shopify/DiscountCodeNode/<id>). The function
// names are kept for interface stability with existing callers.
const API_VERSION = '2026-04'

async function shopifyGraphQL(
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
          customerSelection: { all: true }, // deprecated but valid; "all customers"
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
    // GraphQL updates the code on the same node directly — no delete/recreate.
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
  // Support both old X-Shopify-Hmac-Sha256 and new shopify-hmac-sha256 header formats (2026-01+)
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
