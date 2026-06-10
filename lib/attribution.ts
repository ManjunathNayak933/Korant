import { getSupabaseAdmin } from './supabase'
import { invalidateClientMetrics } from './cache'

export interface AttributionOrder {
  clientId: string
  orderValue: number
  orderId?: string
  discountCode?: string
  mkSlug?: string
  mkSlugFirst?: string
  platform: 'shopify' | 'razorpay' | 'generic'
}

export interface AttributionResult {
  attributed: boolean
  channel?: 'influencer' | 'affiliate' | 'publication'
  entityName?: string
  method?: 'code' | 'cookie' | 'slug'
  commission?: number
  orderId?: string
  error?: string
}

function calcCommission(orderValue: number, type: string, value: number): number {
  if (type === 'flat') return value
  return Math.round((orderValue * value) / 100 * 100) / 100
}

export async function attributeSale(order: AttributionOrder): Promise<AttributionResult> {
  const sb = getSupabaseAdmin()
  const { clientId, orderValue, discountCode, mkSlug, platform } = order
  // Normalize orderId
  const orderId = order.orderId && order.orderId.trim() ? order.orderId.trim() : undefined

  async function isDuplicate(entityType: string, entityId: string): Promise<boolean> {
    if (!orderId) return false
    let q = sb.from('events').select('id').eq('order_id', orderId)
    if (entityType === 'influencer') q = q.eq('influencer_id', entityId)
    else if (entityType === 'affiliate') q = q.eq('affiliate_id', entityId)
    else if (entityType === 'publication') q = q.eq('publication_id', entityId)
    const { data } = await q.single()
    return !!data
  }

  async function insertEvent(params: {
    entityType: string; entityId: string; campaignId?: string | null
    method: string; commission: number
  }) {
    const base = {
      client_id: clientId,
      campaign_id: params.campaignId,
      type: 'code_sale',
      attribution_method: params.method,
      order_value: orderValue,
      discount_code: discountCode,
      commission_amount: params.commission,
      platform,
      order_id: orderId,
    }
    if (params.entityType === 'influencer') Object.assign(base, { influencer_id: params.entityId, type: discountCode ? 'code_sale' : 'cookie_sale' })
    else if (params.entityType === 'affiliate') Object.assign(base, { affiliate_id: params.entityId, type: discountCode ? 'code_sale' : 'cookie_sale' })
    else if (params.entityType === 'publication') Object.assign(base, { publication_id: params.entityId, type: 'cookie_sale' })

    try {
      await sb.from('events').insert(base)
      await invalidateClientMetrics(clientId).catch(() => {})
    } catch {}
  }

  // 1. Discount code → influencer
  if (discountCode) {
    const { data: inf } = await sb
      .from('influencers')
      .select('id, name, campaign_id, fee')
      .eq('client_id', clientId)
      .ilike('discount_code', discountCode.trim())
      .eq('is_active', true)
      .single()

    if (inf) {
      if (await isDuplicate('influencer', inf.id)) return { attributed: false }
      const commission = 0
      await insertEvent({ entityType: 'influencer', entityId: inf.id, campaignId: inf.campaign_id, method: 'code', commission })
      return { attributed: true, channel: 'influencer', entityName: inf.name, method: 'code', commission, orderId }
    }

    // 2. Discount code → affiliate (per_sale only)
    const { data: aff } = await sb
      .from('affiliates')
      .select('id, name, campaign_id, commission_type, commission_value, commission_trigger')
      .eq('client_id', clientId)
      .ilike('discount_code', discountCode.trim())
      .eq('is_active', true)
      .eq('commission_trigger', 'per_sale')
      .single()

    if (aff) {
      if (await isDuplicate('affiliate', aff.id)) return { attributed: false }
      const commission = calcCommission(orderValue, aff.commission_type, aff.commission_value)
      await insertEvent({ entityType: 'affiliate', entityId: aff.id, campaignId: aff.campaign_id, method: 'code', commission })
      return { attributed: true, channel: 'affiliate', entityName: aff.name, method: 'code', commission, orderId }
    }
  }

  // 3. mkSlug → influencer
  if (mkSlug) {
    const { data: inf } = await sb
      .from('influencers')
      .select('id, name, campaign_id')
      .eq('client_id', clientId)
      .eq('redirect_slug', mkSlug)
      .eq('is_active', true)
      .single()

    if (inf) {
      if (await isDuplicate('influencer', inf.id)) return { attributed: false }
      await insertEvent({ entityType: 'influencer', entityId: inf.id, campaignId: inf.campaign_id, method: 'cookie', commission: 0 })
      return { attributed: true, channel: 'influencer', entityName: inf.name, method: 'cookie', commission: 0, orderId }
    }

    // 4. mkSlug → affiliate (per_sale, within attribution window)
    const { data: aff } = await sb
      .from('affiliates')
      .select('id, name, campaign_id, commission_type, commission_value, attribution_window_days')
      .eq('client_id', clientId)
      .eq('redirect_slug', mkSlug)
      .eq('is_active', true)
      .eq('commission_trigger', 'per_sale')
      .single()

    if (aff) {
      // Check attribution window
      const windowStart = new Date(Date.now() - aff.attribution_window_days * 86400000).toISOString()
      const { data: clickEvent } = await sb
        .from('events')
        .select('id')
        .eq('affiliate_id', aff.id)
        .eq('client_id', clientId)
        .eq('type', 'click')
        .gte('timestamp', windowStart)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single()

      if (clickEvent) {
        if (await isDuplicate('affiliate', aff.id)) return { attributed: false }
        const commission = calcCommission(orderValue, aff.commission_type, aff.commission_value)
        await insertEvent({ entityType: 'affiliate', entityId: aff.id, campaignId: aff.campaign_id, method: 'cookie', commission })
        return { attributed: true, channel: 'affiliate', entityName: aff.name, method: 'cookie', commission, orderId }
      }
    }

    // 5. mkSlug → publication
    const { data: pub } = await sb
      .from('publications')
      .select('id, publication_name, campaign_id')
      .eq('client_id', clientId)
      .eq('redirect_slug', mkSlug)
      .eq('is_active', true)
      .single()

    if (pub) {
      if (await isDuplicate('publication', pub.id)) return { attributed: false }
      await insertEvent({ entityType: 'publication', entityId: pub.id, campaignId: pub.campaign_id, method: 'cookie', commission: 0 })
      return { attributed: true, channel: 'publication', entityName: pub.publication_name, method: 'cookie', commission: 0, orderId }
    }
  }

  return { attributed: false }
}
