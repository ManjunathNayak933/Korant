// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/codes.ts                                                │
// └──────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'

// Discount codes share ONE namespace at checkout. A customer types a single
// code, and attributeSale() resolves it influencer-first, then affiliate — so if
// two assets share a code, one silently never gets credited (and commission now
// rides on that credit). We therefore refuse to *assign* a code that another
// asset for the same client already owns, at create- and edit-time.
//
// Note: redirect_slug is already UNIQUE at the DB level, so links can't collide.
// Only discount_code is unconstrained across tables — which is what this closes.

export type CodeTable = 'influencers' | 'affiliates' | 'whatsapp_campaigns'

export interface CodeOwner {
  table: CodeTable
  id: string
  name: string
}

// Tables that can own a checkout discount code, with the column holding the label.
const OWNERS: { table: CodeTable; nameCol: string }[] = [
  { table: 'influencers',        nameCol: 'name' },
  { table: 'affiliates',         nameCol: 'name' },
  { table: 'whatsapp_campaigns', nameCol: 'name' },
]

/**
 * Returns the asset already using `code` for this client, or null if free.
 * Pass `exclude` when editing so a row doesn't conflict with itself.
 */
export async function findDiscountCodeOwner(
  clientId: string,
  code: string | null | undefined,
  exclude?: { table: CodeTable; id: string }
): Promise<CodeOwner | null> {
  const norm = (code || '').trim().toUpperCase()
  if (!norm) return null

  const sb = getSupabaseAdmin()

  for (const { table, nameCol } of OWNERS) {
    let q = sb
      .from(table)
      .select(`id, ${nameCol}`)
      .eq('client_id', clientId)
      .ilike('discount_code', norm)
      .limit(1)
    if (exclude && exclude.table === table) q = q.neq('id', exclude.id)

    // limit(1) + array read avoids maybeSingle()'s throw if legacy dupes exist.
    const { data } = await q
    if (data && data.length) {
      return { table, id: data[0].id, name: (data[0] as any)[nameCol] || 'another asset' }
    }
  }
  return null
}

const LABEL: Record<CodeTable, string> = {
  influencers: 'influencer',
  affiliates: 'affiliate',
  whatsapp_campaigns: 'WhatsApp campaign',
}

/** Human-readable 409 message for a taken code. */
export function codeConflictMessage(code: string, owner: CodeOwner): string {
  return `Discount code "${code.trim().toUpperCase()}" is already assigned to the ${LABEL[owner.table]} "${owner.name}". Each code can belong to only one asset — pick a unique code.`
}
