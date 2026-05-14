// lib/plan-limits.ts
// Plan-based resource limits matching the pricing page
// Basic: 5 influencers, 5 publications, 5 affiliates, 3 campaigns, no WhatsApp, no multi-agency
// Pro:   unlimited everything

export type Plan = 'basic' | 'pro'

export const PLAN_LIMITS: Record<Plan, {
  influencers:  number
  publications: number
  affiliates:   number
  campaigns:    number
  whatsapp:     boolean
  multiAgency:  boolean
}> = {
  basic: {
    influencers:  5,
    publications: 5,
    affiliates:   5,
    campaigns:    3,
    whatsapp:     false,
    multiAgency:  false,
  },
  pro: {
    influencers:  Infinity,
    publications: Infinity,
    affiliates:   Infinity,
    campaigns:    Infinity,
    whatsapp:     true,
    multiAgency:  true,
  },
}

export const UPGRADE_MESSAGE = {
  influencers:  'Basic plan includes up to 5 influencers. Upgrade to Pro for unlimited.',
  publications: 'Basic plan includes up to 5 publications. Upgrade to Pro for unlimited.',
  affiliates:   'Basic plan includes up to 5 affiliates. Upgrade to Pro for unlimited.',
  campaigns:    'Basic plan includes up to 3 campaigns. Upgrade to Pro for unlimited.',
  whatsapp:     'WhatsApp campaigns are available on the Pro plan. Upgrade to access.',
  multiAgency:  'Multi-agency collaboration is available on the Pro plan. Upgrade to access.',
}

type Resource = 'influencers' | 'publications' | 'affiliates' | 'campaigns'

/**
 * Check if a client is allowed to create one more of a given resource.
 * Call this at the top of any POST handler before inserting a new record.
 */
export async function checkPlanLimit(
  sb: any,
  clientId: string,
  resource: Resource
): Promise<{ allowed: true } | { allowed: false; message: string; limit: number; current: number; plan: Plan }> {
  // Get client's plan
  const { data: user } = await sb
    .from('users')
    .select('plan')
    .eq('id', clientId)
    .maybeSingle()

  const plan: Plan  = (user?.plan === 'pro') ? 'pro' : 'basic'
  const limit       = PLAN_LIMITS[plan][resource]
  if (limit === Infinity) return { allowed: true }

  // Count current resources
  const { count } = await sb
    .from(resource)
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const current = count || 0
  if (current >= limit) {
    return {
      allowed: false,
      message: UPGRADE_MESSAGE[resource],
      limit,
      current,
      plan,
    }
  }
  return { allowed: true }
}

/**
 * Check if a client is allowed to use a boolean feature (whatsapp, multiAgency).
 */
export async function checkPlanFeature(
  sb: any,
  clientId: string,
  feature: 'whatsapp' | 'multiAgency'
): Promise<{ allowed: true } | { allowed: false; message: string; plan: Plan }> {
  const { data: user } = await sb
    .from('users')
    .select('plan')
    .eq('id', clientId)
    .maybeSingle()

  const plan: Plan = (user?.plan === 'pro') ? 'pro' : 'basic'
  if (PLAN_LIMITS[plan][feature]) return { allowed: true }

  return { allowed: false, message: UPGRADE_MESSAGE[feature], plan }
}