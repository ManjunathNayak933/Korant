// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/planLimits.ts                                          │
// │ Replace the existing file at <repo-root>/lib/planLimits.ts           │
// └──────────────────────────────────────────────────────────────────────┘
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

// Platform-wide data threshold check for Pro-only features.
// BUG FIX: this used to count EVERY influencer row (>= 10). But the Center only
// shows profiles with `meets_threshold = true` (>= 500 tracked clicks). So a brand
// could clear the gate and then see an empty grid, with the friendly "this grows
// with scale" message no longer showing. We now count only profiles that would
// actually be displayed, so the gate and the grid agree.
const PLATFORM_MIN_PROFILES = 10

export async function isProClient(clientId: string): Promise<boolean> {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('clients')
    .select('plan')
    .eq('id', clientId)
    .single()
  return data?.plan === 'pro'
}

export async function platformHasEnoughData(): Promise<boolean> {
  const sb = getSupabaseAdmin()
  const { count, error } = await sb
    .from('influencer_center')
    .select('handle', { count: 'exact', head: true })
    .eq('meets_threshold', true)
  // If the view is unavailable for any reason, fail safe to "not enough data"
  // (shows the encouraging empty-state rather than a broken/empty grid).
  if (error) return false
  return (count || 0) >= PLATFORM_MIN_PROFILES
}
