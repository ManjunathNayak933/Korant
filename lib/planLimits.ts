import { getSupabaseAdmin } from './supabase'

export const PLAN_LIMITS = {
  basic: { influencers: 5, affiliates: 5, publications: 5, campaigns: 3 },
  pro: { influencers: Infinity, affiliates: Infinity, publications: Infinity, campaigns: Infinity },
}

export type EntityType = 'influencers' | 'affiliates' | 'publications' | 'campaigns'

export async function checkPlanLimit(
  clientId: string,
  entityType: EntityType
): Promise<{ allowed: boolean; message?: string }> {
  const sb = getSupabaseAdmin()

  const { data: client } = await sb
    .from('clients')
    .select('plan')
    .eq('id', clientId)
    .single()

  const plan = (client?.plan || 'basic') as 'basic' | 'pro'
  const limit = PLAN_LIMITS[plan][entityType]

  if (limit === Infinity) return { allowed: true }

  const { count } = await sb
    .from(entityType)
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  if ((count || 0) >= limit) {
    return {
      allowed: false,
      message: `Plan limit reached. Upgrade to Pro to add more ${entityType}.`,
    }
  }

  return { allowed: true }
}
