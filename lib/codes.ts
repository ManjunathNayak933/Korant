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
// BUG FIX: `cart_sequence_steps` was missing from this list. The cart-sequence
// route called findDiscountCodeOwner() before assigning a coupon, but cart
// steps were never registered AS owners — so the guard only worked one way.
// Two cart steps could share a code, and an influencer created later could
// claim a code a cart step already used (and win attribution, since influencers
// resolve first). Cart steps are owners now, and the guard is symmetric.
//
// Note: redirect_slug is already UNIQUE at the DB level, so links can't collide.
// Only discount_code is unconstrained across tables — which is what this closes.

export type CodeTable = 'influencers' | 'affiliates' | 'whatsapp_campaigns' | 'cart_sequence_steps'

export interface CodeOwner {
  table: CodeTable
  id: string
  name: string
}

// Tables that can own a checkout discount code.
//  - `codeCol`: the column holding the code (cart steps use `coupon_code`).
//  - `nameCol`: the column holding a human label, or null when the table has
//    no name (cart steps are labelled from their step number instead).
//  - `idCol`:   the identity used for self-exclusion when editing.
const OWNERS: { table: CodeTable; codeCol: string; nameCol: string | null; idCol: string }[] = [
  { table: 'influencers',        codeCol: 'discount_code', nameCol: 'name',    idCol: 'id' },
  { table: 'affiliates',         codeCol: 'discount_code', nameCol: 'name',    idCol: 'id' },
  { table: 'whatsapp_campaigns', codeCol: 'discount_code', nameCol: 'name',    idCol: 'id' },
  { table: 'cart_sequence_steps', codeCol: 'coupon_code',  nameCol: null,      idCol: 'step_no' },
]

/**
 * Returns the asset already using `code` for this client, or null if free.
 * Pass `exclude` when editing so a row doesn't conflict with itself. For
 * cart_sequence_steps, `exclude.id` is the STEP NUMBER (they're identified
 * per-client by step_no, not by a uuid).
 */
export async function findDiscountCodeOwner(
  clientId: string,
  code: string | null | undefined,
  exclude?: { table: CodeTable; id: string }
): Promise<CodeOwner | null> {
  const norm = (code || '').trim().toUpperCase()
  if (!norm) return null

  const sb = getSupabaseAdmin()

  for (const { table, codeCol, nameCol, idCol } of OWNERS) {
    const cols = nameCol ? `${idCol}, ${nameCol}` : `${idCol}, step_no`
    let q = sb
      .from(table)
      .select(cols)
      .eq('client_id', clientId)
      .ilike(codeCol, norm)
      .limit(1)
    if (exclude && exclude.table === table) q = q.neq(idCol, exclude.id)

    // limit(1) + array read avoids maybeSingle()'s throw if legacy dupes exist.
    // A missing column / table (older schema) returns an error rather than
    // throwing — skip that owner instead of failing the whole check.
    const { data, error } = await q
    if (error) continue
    if (data && data.length) {
      const row = data[0] as any
      const name = nameCol
        ? (row[nameCol] || 'another asset')
        : `Cart message ${row.step_no}`
      return { table, id: String(row[idCol]), name }
    }
  }
  return null
}

const LABEL: Record<CodeTable, string> = {
  influencers: 'influencer',
  affiliates: 'affiliate',
  whatsapp_campaigns: 'WhatsApp campaign',
  cart_sequence_steps: 'cart-abandonment message',
}

/** Human-readable 409 message for a taken code. */
export function codeConflictMessage(code: string, owner: CodeOwner): string {
  return `Discount code "${code.trim().toUpperCase()}" is already assigned to the ${LABEL[owner.table]} "${owner.name}". Each code can belong to only one asset — pick a unique code.`
}
