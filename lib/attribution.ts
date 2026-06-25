// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/attribution.ts                                         │
// │ Replace the existing file at <repo-root>/lib/attribution.ts          │
// └──────────────────────────────────────────────────────────────────────┘
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

// Per-sale commission for an influencer. Off unless the partner has a positive
// value AND an active trigger — so every pre-migration influencer (value 0)
// resolves to 0, preserving the previous "influencers earn no commission" rule.
function influencerCommission(
  orderValue: number,
  inf: { commission_type?: string | null; commission_value?: number | null; commission_trigger?: string | null }
): number {
  const value = Number(inf.commission_value) || 0
  const trigger = inf.commission_trigger || 'per_sale'
  if (value <= 0 || trigger !== 'per_sale') return 0
  return calcCommission(orderValue, inf.commission_type || 'percentage', value)
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
    // maybeSingle: 0 rows → null (not an error). Avoids the noisy PGRST116 that
    // .single() raises on the (common) no-duplicate path.
    const { data } = await q.maybeSingle()
    return !!data
  }

  // Returns the write status so callers never report success on a failed insert.
  // A unique-violation (23505) means a concurrent delivery already inserted this
  // exact (order_id, entity) row — that's a benign idempotent retry, not a failure.
  async function insertEvent(params: {
    entityType: string; entityId: string; campaignId?: string | null
    method: string; commission: number
  }): Promise<{ ok: boolean; duplicate: boolean; error?: string }> {
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

    // Supabase returns errors in `error`, it does NOT throw — so we must inspect it.
    const { error } = await sb.from('events').insert(base)
    if (error) {
      if ((error as any).code === '23505') return { ok: true, duplicate: true }
      console.error('[attributeSale] event insert failed', { clientId, orderId, platform, entityType: params.entityType, error: error.message })
      return { ok: false, duplicate: false, error: error.message }
    }
    await invalidateClientMetrics(clientId).catch(() => {})
    return { ok: true, duplicate: false }
  }

  // 1. Discount code → influencer
  if (discountCode) {
    const { data: inf } = await sb
      .from('influencers')
      .select('id, name, campaign_id, commission_type, commission_value, commission_trigger')
      .eq('client_id', clientId)
      .ilike('discount_code', discountCode.trim())
      .eq('is_active', true)
      .maybeSingle()

    if (inf) {
      if (await isDuplicate('influencer', inf.id)) return { attributed: false }
      // Influencers can now carry a per-sale commission ON TOP of their flat fee.
      // Defaults (trigger 'per_sale', value 0) yield 0 → identical to old behaviour.
      const commission = influencerCommission(orderValue, inf)
      const r = await insertEvent({ entityType: 'influencer', entityId: inf.id, campaignId: inf.campaign_id, method: 'code', commission })
      if (!r.ok) return { attributed: false, error: r.error }
      if (r.duplicate) return { attributed: false }
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
      .maybeSingle()

    if (aff) {
      if (await isDuplicate('affiliate', aff.id)) return { attributed: false }
      const commission = calcCommission(orderValue, aff.commission_type, aff.commission_value)
      const r = await insertEvent({ entityType: 'affiliate', entityId: aff.id, campaignId: aff.campaign_id, method: 'code', commission })
      if (!r.ok) return { attributed: false, error: r.error }
      if (r.duplicate) return { attributed: false }
      return { attributed: true, channel: 'affiliate', entityName: aff.name, method: 'code', commission, orderId }
    }
  }

  // 3. mkSlug → influencer
  if (mkSlug) {
    const { data: inf } = await sb
      .from('influencers')
      .select('id, name, campaign_id, commission_type, commission_value, commission_trigger')
      .eq('client_id', clientId)
      .eq('redirect_slug', mkSlug)
      .eq('is_active', true)
      .maybeSingle()

    if (inf) {
      if (await isDuplicate('influencer', inf.id)) return { attributed: false }
      const commission = influencerCommission(orderValue, inf)
      const r = await insertEvent({ entityType: 'influencer', entityId: inf.id, campaignId: inf.campaign_id, method: 'cookie', commission })
      if (!r.ok) return { attributed: false, error: r.error }
      if (r.duplicate) return { attributed: false }
      return { attributed: true, channel: 'influencer', entityName: inf.name, method: 'cookie', commission, orderId }
    }

    // 4. mkSlug → affiliate (per_sale, within attribution window)
    const { data: aff } = await sb
      .from('affiliates')
      .select('id, name, campaign_id, commission_type, commission_value, attribution_window_days')
      .eq('client_id', clientId)
      .eq('redirect_slug', mkSlug)
      .eq('is_active', true)
      .eq('commission_trigger', 'per_sale')
      .maybeSingle()

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
        .maybeSingle()

      if (clickEvent) {
        if (await isDuplicate('affiliate', aff.id)) return { attributed: false }
        const commission = calcCommission(orderValue, aff.commission_type, aff.commission_value)
        const r = await insertEvent({ entityType: 'affiliate', entityId: aff.id, campaignId: aff.campaign_id, method: 'cookie', commission })
        if (!r.ok) return { attributed: false, error: r.error }
        if (r.duplicate) return { attributed: false }
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
      .maybeSingle()

    if (pub) {
      if (await isDuplicate('publication', pub.id)) return { attributed: false }
      const r = await insertEvent({ entityType: 'publication', entityId: pub.id, campaignId: pub.campaign_id, method: 'cookie', commission: 0 })
      if (!r.ok) return { attributed: false, error: r.error }
      if (r.duplicate) return { attributed: false }
      return { attributed: true, channel: 'publication', entityName: pub.publication_name, method: 'cookie', commission: 0, orderId }
    }
  }

  return { attributed: false }
}

export interface ReversalResult {
  reversed: number
  orderId?: string
  error?: string
}

/**
 * Reverse a previously-attributed sale (refund or cancellation).
 *
 * Marks the matching sale event(s) as reversed rather than deleting them, so the
 * original sale stays in the audit trail. Idempotent: a repeated refund webhook
 * finds nothing left to reverse and no-ops. All-or-nothing — a partial refund
 * reverses the whole commission for that order (see note in the PR/docs).
 *
 * NOTE: aggregations must exclude reversed rows (`reversed_at is null`). The
 * raw-event aggregations in this repo are updated to do so; the external
 * `partner_stats_monthly` view must be updated in the DB (see migration).
 */
export async function reverseSale(params: {
  clientId: string; orderId?: string; platform?: string; reason?: string
}): Promise<ReversalResult> {
  const orderId = params.orderId && params.orderId.trim() ? params.orderId.trim() : undefined
  if (!orderId) return { reversed: 0 }

  const sb = getSupabaseAdmin()

  // Only sale events that aren't already reversed.
  const { data: rows, error: selErr } = await sb
    .from('events')
    .select('id')
    .eq('client_id', params.clientId)
    .eq('order_id', orderId)
    .in('type', ['code_sale', 'cookie_sale'])
    .is('reversed_at', null)

  if (selErr) {
    console.error('[reverseSale] lookup failed', { clientId: params.clientId, orderId, error: selErr.message })
    return { reversed: 0, orderId, error: selErr.message }
  }
  if (!rows || rows.length === 0) return { reversed: 0, orderId }

  const ids = rows.map((r: any) => r.id)
  const { error: updErr } = await sb
    .from('events')
    .update({ reversed_at: new Date().toISOString(), reversal_reason: params.reason || 'refund' })
    .in('id', ids)

  if (updErr) {
    console.error('[reverseSale] update failed', { clientId: params.clientId, orderId, error: updErr.message })
    return { reversed: 0, orderId, error: updErr.message }
  }

  await invalidateClientMetrics(params.clientId).catch(() => {})
  return { reversed: ids.length, orderId }
}
