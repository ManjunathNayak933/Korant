import { getSupabaseAdmin } from './supabase'

async function shopifyFetch(domain: string, token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${domain}/admin/api/2026-04${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify ${method} ${path} failed: ${res.status} ${text}`)
  }
  return res.json()
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
    // Check if discount code already exists — if so, return its existing price rule
    try {
      const existing = await shopifyFetch(client.shopify_domain, client.shopify_token,
        `/discount_codes/lookup.json?code=${encodeURIComponent(discountCode)}`)
      if (existing?.discount_code) {
        return { priceRuleId: existing.discount_code.price_rule_id, discountCodeId: existing.discount_code.id }
      }
    } catch {} // code doesn't exist yet — proceed to create

    const valueType = fixedAmount ? 'fixed_amount' : 'percentage'
    const value = fixedAmount ? `-${fixedAmount}` : `-${percentOff}`

    const ruleRes = await shopifyFetch(client.shopify_domain, client.shopify_token, '/price_rules.json', 'POST', {
      price_rule: {
        title: `KORANT-${discountCode}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: valueType,
        value,
        customer_selection: 'all',
        starts_at: new Date().toISOString(),
        usage_limit: null,
        once_per_customer: false,
      },
    })

    const priceRuleId = ruleRes.price_rule.id

    const codeRes = await shopifyFetch(
      client.shopify_domain, client.shopify_token,
      `/price_rules/${priceRuleId}/discount_codes.json`, 'POST',
      { discount_code: { code: discountCode } }
    )

    return { priceRuleId, discountCodeId: codeRes.discount_code.id }
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
    // Update the price rule title
    await shopifyFetch(client.shopify_domain, client.shopify_token,
      `/price_rules/${priceRuleId}.json`, 'PUT', {
        price_rule: {
          id: priceRuleId,
          title: `KORANT-${newCode}`,
          value: `-${percentOff}`,
        }
      }
    )

    // Get existing codes and delete them
    const codesRes = await shopifyFetch(client.shopify_domain, client.shopify_token,
      `/price_rules/${priceRuleId}/discount_codes.json`
    )
    for (const code of codesRes.discount_codes || []) {
      await shopifyFetch(client.shopify_domain, client.shopify_token,
        `/price_rules/${priceRuleId}/discount_codes/${code.id}.json`, 'DELETE'
      )
    }

    // Create new code
    await shopifyFetch(client.shopify_domain, client.shopify_token,
      `/price_rules/${priceRuleId}/discount_codes.json`, 'POST',
      { discount_code: { code: newCode } }
    )
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
    await shopifyFetch(client.shopify_domain, client.shopify_token,
      `/price_rules/${priceRuleId}.json`, 'DELETE'
    )
  } catch (e) {
    console.error('Shopify price rule deletion failed:', e)
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