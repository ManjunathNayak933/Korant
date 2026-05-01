import { getSupabaseAdmin } from './supabase'

async function shopifyFetch(domain: string, token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${domain}/admin/api/2024-01${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Shopify ${method} ${path} failed: ${res.status}`)
  return res.json()
}

export async function createShopifyDiscountCode(
  clientId: string,
  discountCode: string,
  percentOff: number = 10
): Promise<{ priceRuleId: number; discountCodeId: number } | null> {
  const sb = getSupabaseAdmin()
  const { data: client } = await sb
    .from('clients')
    .select('shopify_domain, shopify_token')
    .eq('id', clientId)
    .single()

  if (!client?.shopify_domain || !client?.shopify_token) return null

  try {
    // Create price rule
    const ruleRes = await shopifyFetch(client.shopify_domain, client.shopify_token, '/price_rules.json', 'POST', {
      price_rule: {
        title: `KORANT-${discountCode}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'percentage',
        value: `-${percentOff}`,
        customer_selection: 'all',
        starts_at: new Date().toISOString(),
      },
    })

    const priceRuleId = ruleRes.price_rule.id

    // Create discount code
    await shopifyFetch(client.shopify_domain, client.shopify_token, `/price_rules/${priceRuleId}/discount_codes.json`, 'POST', {
      discount_code: { code: discountCode },
    })

    return { priceRuleId, discountCodeId: priceRuleId }
  } catch (e) {
    console.error('Shopify discount creation failed:', e)
    return null
  }
}

export async function deleteShopifyPriceRule(
  clientId: string,
  priceRuleId: number
): Promise<void> {
  const sb = getSupabaseAdmin()
  const { data: client } = await sb
    .from('clients')
    .select('shopify_domain, shopify_token')
    .eq('id', clientId)
    .single()

  if (!client?.shopify_domain || !client?.shopify_token) return

  try {
    await shopifyFetch(client.shopify_domain, client.shopify_token, `/price_rules/${priceRuleId}.json`, 'DELETE')
  } catch (e) {
    console.error('Shopify price rule deletion failed:', e)
  }
}

export function verifyShopifyWebhook(body: string, hmacHeader: string, secret: string): boolean {
  // Note: In edge runtime, use Web Crypto API
  // This is handled in the webhook route
  return true // placeholder — actual verification in route
}
