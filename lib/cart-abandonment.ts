// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/cart-abandonment.ts                                       
// │ ── Fixes in THIS revision ────────────────────────────────────────────────│
// │ P1a MAX_SENDS_PER_RUN budgeted only SUCCESSFUL SENDS. Held and skipped    │
// │     carts each cost a claim plus an update and decremented nothing, so a  │
// │     client with 200 due carts and a pending template did 400 subrequests  │
// │     while `capped` stayed false — enough clients like that and the        │
// │     invocation blew Cloudflare's subrequest cap, the per-client catch     │
// │     swallowed it, and the endpoint reported {ok:true, sent:0}. There is   │
// │     now a WORK budget, and holds/skips are single atomic statements.      │
// │ P1b reverseCartRecovery() — refunds and cancellations never un-recovered  │
// │     a cart, so recovered revenue only ever went up.                       │
// │ P2a normalizePhone() mangled two real formats: a trunk zero AFTER the     │
// │     country code ("+91 0 98765…" → 13 digits, never matched), and any     │
// │     ten-digit foreign number ("+65 6123 4567" → "916561234567").          │
// │ P2b Media-headed templates could never send: whatsapp_templates stores    │
// │     header_type/header_media_id but the tick never passed them, so Meta   │
// │     rejected every image-headed cart template — which is most of them.    │
// │ P3a intake now accepts the source's real abandonment time. The hourly     │
// │     poll stamped `now`, shifting the H4 anchor and the expiry clock by up │
// │     to an hour and bucketing late-night carts into the wrong month.       │
// │ P3b patchExisting() reported scheduled:true immediately after standing a  │
// │     cart DOWN — `patch.next_step_at ?? existing.next_step_at` falls       │
// │     through an explicit null to the old timestamp.                        │
// └──────────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'
import { getWAConfig, sendTemplateMessage, findDynamicUrlButtonIndex } from './whatsapp'
import { fetchShopifyAbandonedCheckouts } from './shopify'

// ── Constants ───────────────────────────────────────────────────────────────
export const IST_TIMEZONE = 'Asia/Kolkata'
const IST_OFFSET_MS = 5.5 * 3600000       // UTC+05:30, fixed — India has no DST
const DAY_MS = 86400000

// Safety budgets for one cron invocation (Cloudflare caps subrequests per
// invocation — 1,000 on paid plans). Anything left over is picked up by the
// next hourly run (carts stay claimed-and-due).
const MAX_SENDS_PER_RUN = 80
// Every client gets at least this many sends before the global budget is
// allowed to run out, so one large brand can't starve the rest of the platform.
const MIN_SENDS_PER_CLIENT = 5
const MAX_DUE_CARTS_PER_CLIENT = 200
// A claimed cart that crashes mid-send self-heals after this lease expires.
const CLAIM_LEASE_MS = 2 * 3600000
// Each cart costs subrequests whether or not it ends in a send (claim + send +
// log + advance for a send; claim + update for a hold or a skip). The per-client
// work budget is the send budget times this, so a client whose carts are ALL
// being held can't quietly consume the whole invocation.
const WORK_PER_SEND = 4
// Shopify polling costs ~3 subrequests per checkout. Budget it explicitly so it
// can never consume the invocation before any message is sent.
const MAX_POLL_INTAKES_PER_CLIENT = 25
const MAX_POLL_INTAKES_PER_RUN = 100
// Stats: how many carts we can attribute per-step sends for before the figure
// degrades to an approximation (150 × 20 = 3,000 carts in the window).
const STATS_COHORT_CHUNK = 150
const STATS_MAX_COHORT_CHUNKS = 20

// ── Phone normalisation ─────────────────────────────────────────────────────
// Strip non-digits, drop trunk/IDD zeros ("0", "00", "0091"), then default a
// bare 10-digit number to India (+91). Returns '' when the number can't be
// messaged — the cart is still stored, just not chased.
//
// ── Fixes in this revision ──────────────────────────────────────────────────
// P2a  The trunk zero was only stripped from the START OF THE STRING, so
//      "+91 0 98765 43210" (which Shopify checkout fields routinely carry)
//      survived as the 13-digit "9109876543210" and never matched the 12-digit
//      "919876543210" stored from another source. Result: a duplicate cart, a
//      duplicate message, and a recovery match that misses after the customer
//      has already paid — the exact failure M9 was written to close, one branch
//      over. The country-code-then-zero case is now handled explicitly.
// P2b  `p.length === 10` prepended 91 to ANY ten-digit number. Singapore
//      (+65 + 8 digits), Denmark and Norway are all 10 digits in E.164, so
//      "+65 6123 4567" became "916561234567" — an invalid Indian mobile that
//      Meta rejects on every retry until the cart expires. The digits alone
//      cannot settle this (a Singapore number starting 6 looks exactly like an
//      Indian mobile starting 6), but the LEADING "+" or "00" can: it means
//      the caller has already supplied a country code, so we must not add one.
export function normalizePhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()

  // A leading "+" or IDD "00" says: this is already E.164, country code
  // included. Anything else is treated as a local Indian number.
  const explicitIntl = /^(\+|00)/.test(s)

  let p = s.replace(/\D/g, '')
  if (!p) return ''

  // "09876543210" (trunk prefix) and "00919876543210" (IDD prefix) must land on
  // the same string as "+91 98765 43210", or recovery matching silently misses
  // and we keep messaging a customer who has already paid.
  p = p.replace(/^0+/, '')
  if (!p) return ''

  // P2a: a trunk zero sitting BETWEEN the country code and the subscriber
  // number ("+91 0 98765 43210" — Shopify checkout fields carry these). The
  // leading-zero strip above never saw it. Only rewrite when what's left is a
  // real Indian mobile, so a legitimate 13-digit foreign number is untouched.
  if (p.length === 13 && p.startsWith('910') && /^[6-9]/.test(p.slice(3))) {
    p = `91${p.slice(3)}`
  }

  // P2b: default a BARE ten-digit number to India — but only when the input
  // didn't already carry a country code. Indian mobiles start 6-9.
  if (!explicitIntl && p.length === 10 && /^[6-9]/.test(p)) p = `91${p}`

  // E.164 tops out at 15 digits. The floor differs by how much we trust the
  // input: an explicitly international number is taken at face value (some
  // country code + subscriber pairs are genuinely short), whereas a bare local
  // string shorter than 11 after the India default is junk we can't dial.
  const minLen = explicitIntl ? 8 : 11
  return (p.length >= minLen && p.length <= 15) ? p : ''
}

// ── Scheduling (IST only) ───────────────────────────────────────────────────
// Add `delayDays` to the base instant, then snap to `sendHour` (0-23) on that
// IST calendar day. If the result is not strictly after base (delay 0 and the
// hour already passed today), roll to the next day. Pure arithmetic — correct
// by construction for a fixed-offset zone, verified: 10 → 10:00 IST exactly.
export function nextSendInstant(baseIso: string, delayDays: number, sendHour: number): string {
  const base = new Date(baseIso).getTime()
  const hour = Math.min(23, Math.max(0, Math.trunc(Number(sendHour)))) || 0
  const target = base + Math.max(0, Number(delayDays) || 0) * DAY_MS

  // Midnight (00:00 IST) of the target's IST calendar day, as a UTC instant.
  const istDayStart = Math.floor((target + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
  let send = istDayStart + hour * 3600000
  if (send <= base) send += DAY_MS
  return new Date(send).toISOString()
}

// ── Small helpers ───────────────────────────────────────────────────────────
// Coerce to a finite number, treating 0 as a VALID value (plain `|| default`
// silently turned delay 0 into 1 and send hour 0 into 10).
export function numOr(v: unknown, def: number): number {
  // Number(null) === 0 and Number('') === 0, both finite — so a NULL/empty
  // column silently became 0. For expiry_days that meant `now - 0 days`, i.e.
  // EVERY open cart expired on the next tick. Reject the empties first.
  if (v === null || v === undefined || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

// Drain a PostgREST query past the 1,000-row response cap. `build(from, to)`
// must return a fresh query with `.range(from, to)` applied.
async function pageAll<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  maxPages = 25
): Promise<T[]> {
  const out: T[] = []
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await build(p * pageSize, (p + 1) * pageSize - 1)
    if (error || !data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

// First enabled step of a client's sequence (ordered by step_no), or null.
function firstEnabledStep(steps: any[]): any | null {
  return (steps || [])
    .filter(s => s.enabled !== false)
    .sort((a, b) => (a.step_no || 0) - (b.step_no || 0))[0] || null
}

// ── Sequence context ────────────────────────────────────────────────────────
// The per-client config every intake needs. Loading it once and passing it in
// is what keeps the hourly Shopify poll from costing 2 extra queries PER
// CHECKOUT (H6) — 50 checkouts used to mean 100 avoidable subrequests.
export interface SequenceContext { seq: any | null; steps: any[] }

export async function loadSequenceContext(clientId: string): Promise<SequenceContext> {
  const sb = getSupabaseAdmin()
  const [{ data: seq }, { data: steps }] = await Promise.all([
    sb.from('cart_sequences').select('*').eq('client_id', clientId).maybeSingle(),
    sb.from('cart_sequence_steps').select('step_no, delay_days, enabled')
      .eq('client_id', clientId).order('step_no', { ascending: true }),
  ])
  return { seq: seq || null, steps: steps || [] }
}

// ── Intake: store/refresh one abandoned cart from any source ─────────────────
export interface CartIntake {
  clientId: string
  phone?: string | null
  email?: string | null
  name?: string | null
  optedIn?: boolean
  /**
   * Did this source actually SEE a consent field? Shopify's polled
   * abandonedCheckouts has no customer node for guest checkouts, and the
   * minimal fallback query drops consent entirely — in both cases `optedIn`
   * is false because we don't know, not because the shopper declined.
   * Writing that over a cart the webhook opted in silently un-subscribes them
   * from the sequence. Pass false when consent could not be observed; an
   * observed decline (an explicit "not_subscribed") should pass true so a real
   * revocation still takes effect.
   */
  consentKnown?: boolean
  identitySource?: 'logged_in' | 'checkout' | 'known_visitor'
  cartValue?: number
  currency?: string
  items?: { title?: string; qty?: number; price?: number }[]
  recoveryUrl?: string | null
  source?: string
  externalId?: string | null
  /**
   * When the cart was ACTUALLY abandoned, if the source knows. The hourly
   * Shopify poll sees checkouts up to an hour after the fact; stamping those
   * with `now` shifted the H4 schedule anchor and the expiry_days clock by up
   * to an hour, and could bucket a 23:xx cart into the wrong month on the
   * dashboard. Omit it and we fall back to now, as before.
   */
  abandonedAt?: string | null
  /**
   * P2c: OTHER ids that could identify a cart this source has already stored
   * under a different name. Looked up before inserting; never written.
   *
   * Shopify hands us two different identifiers for one checkout — the REST
   * `checkout.token` that CHECKOUTS_CREATE/UPDATE carries, and the `cn` token
   * embedded in the GraphQL poll's abandonedCheckoutUrl. Without this the two
   * paths create two rows for one shopper and message them twice.
   */
  altExternalIds?: (string | null | undefined)[]
}

export interface IntakeResult {
  stored: boolean
  cartId?: string
  scheduled?: boolean
  messageable?: boolean
  reason?: string
}

export async function intakeAbandonedCart(
  input: CartIntake,
  ctx?: SequenceContext
): Promise<IntakeResult> {
  const sb = getSupabaseAdmin()
  const phone = normalizePhone(input.phone)
  const email = (input.email || '').trim().toLowerCase() || null

  // Nothing to identify the shopper by at all — there is no cart to speak of.
  // (An email-only cart IS stored: it counts as detected, and if a later
  // refresh brings a phone we can start chasing it.)
  if (!phone && !email) return { stored: false, reason: 'no_contact' }

  const { seq, steps } = ctx || await loadSequenceContext(input.clientId)
  const startStep = firstEnabledStep(steps)
  const sendHour = numOr(seq?.send_hour, 10)
  const startDelay = numOr(startStep?.delay_days, 1)
  const optedIn = input.optedIn === true
  const consentKnown = input.consentKnown !== false

  // Only a cart we can actually message gets a schedule.
  const canSchedule = !!(phone && seq?.enabled && startStep && optedIn)
  const nowIso = new Date().toISOString()

  // Trust a supplied abandonment time only if it parses and isn't in the
  // future (a bad clock on a storefront snippet must not park a cart forever).
  const abandonedAt = (() => {
    const t = input.abandonedAt ? new Date(input.abandonedAt).getTime() : NaN
    return Number.isFinite(t) && t <= Date.now() ? new Date(t).toISOString() : nowIso
  })()
  // H4: the schedule belongs to the ABANDONMENT, not to whenever the latest
  // webhook or poll happened to touch the row.
  const scheduleFrom = (abandonedAt: string) =>
    nextSendInstant(abandonedAt || nowIso, startDelay, sendHour)

  const items = Array.isArray(input.items) ? input.items : []
  const row: Record<string, any> = {
    client_id: input.clientId,
    phone: phone || null,
    email,
    contact_name: input.name || null,
    identity_source: input.identitySource || 'checkout',
    opted_in: optedIn,
    cart_value: input.cartValue ?? 0,
    currency: input.currency || 'INR',
    item_count: items.length,
    cart_items: items,
    recovery_url: input.recoveryUrl || null,
    source: input.source || 'generic',
    external_id: input.externalId || null,
    status: 'open',
    // Start the sequence at the first ENABLED step (step 1 may be disabled).
    last_step_sent: startStep ? (startStep.step_no - 1) : 0,
    // H4: anchor on the ABANDONMENT, which for a polled checkout is not now.
    next_step_at: canSchedule ? scheduleFrom(abandonedAt) : null,
    abandoned_at: abandonedAt,
    updated_at: nowIso,
  }

  type ExistingCart = {
    id: string
    status: string
    opted_in: boolean | null
    last_step_sent: number | null
    next_step_at: string | null
    abandoned_at: string
    recovery_url: string | null
    phone: string | null
    email: string | null
  }
  const EXISTING_COLS =
    'id, status, opted_in, last_step_sent, next_step_at, abandoned_at, recovery_url, phone, email'

  // Every id this checkout might already be stored under, primary first.
  const candidateIds = Array.from(new Set(
    [input.externalId, ...(input.altExternalIds || [])]
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
  ))

  const findExisting = async (): Promise<ExistingCart | null> => {
    if (!candidateIds.length) return null
    // One statement, not one per id — this runs on every webhook delivery.
    const { data } = await sb
      .from('abandoned_carts').select(EXISTING_COLS)
      .eq('client_id', input.clientId).in('external_id', candidateIds)
      .order('abandoned_at', { ascending: true })
      .limit(1)
    return (data?.[0] as ExistingCart) || null
  }

  // Refresh an existing cart. Deliberately does NOT rewind an in-flight
  // sequence and does NOT move a schedule that has already been decided.
  const patchExisting = async (existing: ExistingCart): Promise<IntakeResult> => {
    if (existing.status !== 'open') {
      return { stored: true, cartId: existing.id, scheduled: false }
    }

    // H3: only write consent when this source could actually observe it.
    const effectiveOptedIn = consentKnown ? optedIn : (existing.opted_in ?? false)

    const patch: Record<string, any> = {
      cart_value: row.cart_value,
      currency: row.currency,
      item_count: row.item_count,
      cart_items: row.cart_items,
      recovery_url: row.recovery_url || existing.recovery_url,
      // Never blank out contact details we already hold with an update that
      // simply didn't carry them.
      phone: phone || existing.phone,
      email: email || existing.email,
      contact_name: row.contact_name,
      opted_in: effectiveOptedIn,
      updated_at: nowIso,
    }

    const notStartedYet = (existing.last_step_sent ?? 0) === 0
    const canScheduleNow = !!(patch.phone && seq?.enabled && startStep && effectiveOptedIn)

    if (notStartedYet) {
      if (!canScheduleNow) {
        // Consent revoked (or removed) before the first message — stand down.
        patch.next_step_at = null
      } else if (!existing.next_step_at) {
        // H4: first time this cart becomes schedulable. Anchor on when it was
        // ABANDONED, not on now, so an hourly refresh can't push it a day out.
        patch.next_step_at = scheduleFrom(existing.abandoned_at)
      }
      // else: already scheduled → leave it exactly where it is.
    }

    const { error } = await sb.from('abandoned_carts').update(patch).eq('id', existing.id)
    if (error) return { stored: false, cartId: existing.id, reason: error.message }

    // `patch.next_step_at ?? existing.next_step_at` reported scheduled: true
    // immediately after standing a cart DOWN — the stand-down writes an
    // explicit null, and ?? falls straight through it to the old timestamp.
    // Ask whether the key was written, not whether its value is truthy.
    const effectiveNext = Object.prototype.hasOwnProperty.call(patch, 'next_step_at')
      ? patch.next_step_at
      : existing.next_step_at

    return {
      stored: true,
      cartId: existing.id,
      scheduled: !!effectiveNext,
      messageable: canScheduleNow,
    }
  }

  // Upsert on the source's own id when we have one, so repeated "checkout
  // updated" webhooks refresh the same cart instead of creating duplicates.
  const existing = await findExisting()
  if (existing) return patchExisting(existing)

  const { data: inserted, error } = await sb
    .from('abandoned_carts').insert(row).select('id').single()

  if (error) {
    // H2: a concurrent delivery won the race and inserted this checkout first
    // (unique index on client_id + external_id). Treat it as a refresh, not a
    // failure — otherwise CHECKOUTS_CREATE and CHECKOUTS_UPDATE arriving
    // together produced two carts and two identical WhatsApp messages.
    if ((error as any).code === '23505') {
      const again = await findExisting()
      if (again) return patchExisting(again)
    }
    return { stored: false, reason: error.message }
  }

  return {
    stored: true,
    cartId: inserted.id,
    scheduled: !!row.next_step_at,
    messageable: canSchedule,
  }
}

// ── Recovery: a purchase arrived — stop the sequence + attribute the sale ─────
// Called from order webhooks (Shopify orders/paid, generic, Razorpay). Matches
// FIRST by the checkout's own external id (exact — Shopify orders carry
// checkout_token, which is what intake stored), then by phone/email against
// this client's carts within the expiry window. Phone/email matching runs as
// separate parameterised queries — no string-built OR filter, so a crafted
// email can no longer inject PostgREST filter syntax.
export async function recoverCartsForOrder(input: {
  clientId: string
  phone?: string | null
  email?: string | null
  orderId: string
  orderValue: number
  externalId?: string | null   // e.g. Shopify order.checkout_token
  /**
   * P2c: additional ids the cart might be stored under. Shopify orders carry
   * BOTH `checkout_token` (what the CHECKOUTS_* webhook stored) and
   * `checkout_id` (what the GraphQL poll can produce), and which one is on the
   * cart depends on which path saw it first. Pass both.
   */
  externalIds?: (string | null | undefined)[]
}): Promise<{ recovered: number; step?: number | null; duplicate?: boolean }> {
  const sb = getSupabaseAdmin()
  const phone = normalizePhone(input.phone)
  const email = (input.email || '').trim().toLowerCase() || null
  const externalIds = Array.from(new Set(
    [input.externalId, ...(input.externalIds || [])]
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
  ))
  const orderId = String(input.orderId || '').trim()
  if (!phone && !email && !externalIds.length) return { recovered: 0 }

  // ── H1: idempotency ───────────────────────────────────────────────────────
  // Shopify registers ORDERS_CREATE *and* ORDERS_PAID, and a normal online
  // checkout fires both with financial_status = 'paid', so this function runs
  // twice for one purchase. The first run marks the matched cart 'recovered'
  // and supersedes the buyer's other OPEN carts — but a 'completed' cart of
  // the same buyer stays matchable by design (that's how a last-message
  // recovery gets credited), so the second run used to stamp THAT cart with
  // the same order id and the same value. Recovered revenue was double
  // counted for every repeat abandoner. One cheap lookup closes it.
  if (orderId) {
    const { data: already } = await sb
      .from('abandoned_carts').select('id, recovered_by_step')
      .eq('client_id', input.clientId).eq('recovered_order_id', orderId).limit(1)
    if (already?.[0]) {
      return { recovered: 0, step: already[0].recovered_by_step ?? 0, duplicate: true }
    }
  }

  const { data: seq } = await sb
    .from('cart_sequences').select('expiry_days').eq('client_id', input.clientId).maybeSingle()
  const windowStart = new Date(Date.now() - (numOr(seq?.expiry_days, 14)) * DAY_MS).toISOString()

  type CartRow = {
    id: string; last_step_sent: number | null; abandoned_at: string; status: string
  }
  const byId = new Map<string, CartRow>()
  let exactMatch: CartRow | null = null

  // A cart whose sequence has finished is marked 'completed' — including the
  // instant after message 1 on a single-message sequence. Matching only 'open'
  // meant a purchase driven by the LAST message was never credited: the headline
  // "revenue recovered by this activity" sat at zero by construction, and
  // recovered_by_step could never reach the final step. Finished carts are the
  // ones most likely to convert, so they must stay matchable. 'expired' stays
  // out — past expiry_days we no longer claim the sale.
  const RECOVERABLE = ['open', 'completed']

  // 1) Exact match on the checkout's own id (no time window — it IS this cart).
  if (externalIds.length) {
    const { data } = await sb.from('abandoned_carts')
      .select('id, last_step_sent, abandoned_at, status')
      .eq('client_id', input.clientId).in('status', RECOVERABLE).in('external_id', externalIds)
      .order('abandoned_at', { ascending: false })
      .limit(1)
    if (data?.[0]) { exactMatch = data[0]; byId.set(data[0].id, data[0]) }
  }

  // 2) Same-buyer matches by phone and by email (separate safe queries).
  const buyerQueries: PromiseLike<{ data: CartRow[] | null; error: any }>[] = []
  if (phone) {
    buyerQueries.push(sb.from('abandoned_carts')
      .select('id, last_step_sent, abandoned_at, status')
      .eq('client_id', input.clientId).in('status', RECOVERABLE).eq('phone', phone)
      .gte('abandoned_at', windowStart).order('abandoned_at', { ascending: false }).limit(50))
  }
  if (email) {
    buyerQueries.push(sb.from('abandoned_carts')
      .select('id, last_step_sent, abandoned_at, status')
      .eq('client_id', input.clientId).in('status', RECOVERABLE).eq('email', email)
      .gte('abandoned_at', windowStart).order('abandoned_at', { ascending: false }).limit(50))
  }
  for (const q of buyerQueries) {
    const { data } = await q
    for (const c of data || []) if (!byId.has(c.id)) byId.set(c.id, c)
  }

  if (byId.size === 0) return { recovered: 0 }

  // Credit the exact checkout when we have it, else the most recent match.
  const all = Array.from(byId.values())
    .sort((a, b) => new Date(b.abandoned_at).getTime() - new Date(a.abandoned_at).getTime())
  const primary = exactMatch || all[0]
  const nowIso = new Date().toISOString()

  // ── H5: credit the message that ACTUALLY went out ─────────────────────────
  // last_step_sent is also advanced when a step is SKIPPED (its row is missing
  // or disabled at tick time), so using it here credited revenue to messages
  // that were never sent. cart_messages is the record of what left the
  // building; 0 means "bought before any message", which is what the tab shows
  // as organic.
  let step = 0
  {
    const { data: delivered } = await sb.from('cart_messages')
      .select('step_no').eq('cart_id', primary.id).neq('status', 'failed')
      .order('step_no', { ascending: false }).limit(1)
    step = delivered?.[0]?.step_no ?? 0
  }

  await sb.from('abandoned_carts').update({
    status: 'recovered',
    recovered_at: nowIso,
    recovered_order_id: orderId,
    recovered_value: input.orderValue || 0,
    recovered_by_step: step,           // 0 = recovered before any message went out
    next_step_at: null,
    updated_at: nowIso,
  }).eq('id', primary.id)

  // Stop the buyer's OTHER carts that are still IN FLIGHT. Prefer a distinct
  // 'superseded' status so "stopped because they bought" isn't conflated with
  // "sequence finished"; if the DB constrains status values and rejects it,
  // fall back to 'completed'. A cart that already reads 'completed' has nothing
  // left to send, so it is left alone rather than relabelled.
  const others = all.filter(c => c.id !== primary.id && c.status === 'open').map(c => c.id)
  if (others.length) {
    const { error: supErr } = await sb.from('abandoned_carts')
      .update({ status: 'superseded', next_step_at: null, updated_at: nowIso }).in('id', others)
    if (supErr) {
      await sb.from('abandoned_carts')
        .update({ status: 'completed', next_step_at: null, updated_at: nowIso }).in('id', others)
    }
  }

  return { recovered: 1, step }
}

// ── Reversal: the recovered order was refunded or cancelled ──────────────────
// reverseSale() in lib/attribution.ts only ever touched `events`, so nothing
// wrote back to abandoned_carts. A refunded order stayed status = 'recovered'
// with its full recovered_value forever, which permanently inflated the tab's
// headline "revenue recovered by this activity", the Overview KPI and
// recoveryRate. On a fashion/footwear D2C running 25-35% returns that is not a
// rounding error.
//
// The cart is moved to 'expired' rather than back to 'open': the shopper did
// complete a purchase, and restarting a "you left something behind" sequence at
// a customer who has just returned an order is worse than losing the row.
// Idempotent — a retried refund webhook matches nothing the second time.
export async function reverseCartRecovery(input: {
  clientId: string
  orderId: string
}): Promise<{ reversed: number }> {
  const orderId = String(input.orderId || '').trim()
  if (!orderId) return { reversed: 0 }

  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('abandoned_carts')
    .update({
      status: 'expired',
      recovered_at: null,
      recovered_order_id: null,
      recovered_value: 0,
      recovered_by_step: null,
      next_step_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', input.clientId)
    .eq('recovered_order_id', orderId)
    .eq('status', 'recovered')
    .select('id')

  if (error) {
    console.error('[reverseCartRecovery] failed', {
      clientId: input.clientId, orderId, error: error.message,
    })
    return { reversed: 0 }
  }
  return { reversed: data?.length || 0 }
}

// ── Shopify polling fallback ─────────────────────────────────────────────────
// Belt-and-braces alongside the CHECKOUTS_CREATE/UPDATE webhooks: the GraphQL
// Admin `abandonedCheckouts` query returns every checkout where the shopper
// entered contact details but didn't pay — including stores on Checkout
// Extensibility where webhook delivery has historically been patchy. Fully
// external checkouts (GoKwik-style) never reach Shopify at all; those use the
// platform-neutral /api/webhook/cart endpoint instead.
//
// H6: `limit` is a hard budget on how many checkouts this may intake, and the
// sequence context is passed in so the per-checkout cost is ~2 subrequests
// instead of ~4.
async function pollShopifyAbandonedCarts(
  clientId: string,
  ctx: SequenceContext,
  limit: number
): Promise<number> {
  if (limit <= 0) return 0
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString() // last 24h
  const checkouts = await fetchShopifyAbandonedCheckouts(clientId, sinceIso, limit)
  let stored = 0
  for (const c of checkouts) {
    if (stored >= limit) break
    const r = await intakeAbandonedCart({
      clientId,
      phone: c.phone,
      email: c.email,
      name: c.name,
      optedIn: c.optedIn,
      // H3: false when the query couldn't see a consent field at all.
      consentKnown: c.consentKnown,
      identitySource: 'checkout',
      cartValue: c.totalPrice,
      currency: c.currency,
      items: c.items,
      recoveryUrl: c.recoveryUrl,
      source: 'shopify',
      externalId: c.externalId,
      // P2c: the poll's id (a `cn` token on Checkout Extensibility stores) is
      // not the REST checkout.token the webhook stores. Look the cart up under
      // the numeric checkout id too, so the two paths converge on ONE row.
      altExternalIds: [c.checkoutId],
      // The poll runs up to an hour after the fact — date the cart when the
      // shopper actually left, not when we noticed.
      abandonedAt: c.createdAt || null,
    }, ctx)
    if (r.stored) stored++
  }
  return stored
}

// ── The hourly tick: send whichever step is now due for each open cart ────────
export interface TickResult {
  processed: number
  sent: number
  failed: number
  expired: number
  held: number
  polled: number
  capped: boolean
  /** Populated when a configuration problem is holding messages back. */
  warnings: string[]
}

export async function runCartAbandonmentTick(nowIso = new Date().toISOString()): Promise<TickResult> {
  const sb = getSupabaseAdmin()
  const nowMs = new Date(nowIso).getTime()
  let processed = 0, sent = 0, failed = 0, expired = 0, held = 0, polled = 0
  let capped = false
  let sendBudget = MAX_SENDS_PER_RUN
  let pollBudget = MAX_POLL_INTAKES_PER_RUN
  const warnings = new Set<string>()

  // Only clients with an enabled sequence are in play (paginated — the 1,000
  // row PostgREST cap must not silently drop clients past it).
  const seqs = await pageAll<any>((from, to) =>
    sb.from('cart_sequences').select('*').eq('enabled', true).range(from, to))
  if (!seqs.length) {
    return { processed, sent, failed, expired, held, polled, capped, warnings: [] }
  }

  // H7: shuffle. The budget below is global, and PostgREST returns these rows
  // in a stable order, so the same clients used to drain it every single hour
  // while the tail of the list never sent anything.
  for (let i = seqs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[seqs[i], seqs[j]] = [seqs[j], seqs[i]]
  }
  const perClientBudget = Math.max(MIN_SENDS_PER_CLIENT, Math.ceil(MAX_SENDS_PER_RUN / seqs.length))
  const perClientPoll = Math.max(1, Math.min(MAX_POLL_INTAKES_PER_CLIENT,
    Math.ceil(MAX_POLL_INTAKES_PER_RUN / seqs.length)))

  // Paused / suspended clients must not keep messaging customers (or accruing
  // Meta charges). Fetch statuses in chunks and skip anything not active.
  const statusById: Record<string, string> = {}
  const ids = seqs.map(s => s.client_id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('clients').select('id, status').in('id', ids.slice(i, i + 200))
    for (const c of data || []) statusById[c.id] = c.status
  }

  // M1: NEXT_PUBLIC_* is inlined at BUILD time. If it wasn't present in the
  // build environment and BASE_URL isn't set at runtime, this is '' — and a
  // `__link__` body variable would ship "/r/slug.cartid" to a real customer.
  const base = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '')
  const baseOk = /^https?:\/\//i.test(base)
  if (!baseOk) {
    warnings.add('BASE_URL is not set — messages that carry the link in the message body are being held. Set BASE_URL (or NEXT_PUBLIC_BASE_URL at build time) to your public origin.')
  }

  for (const seq of seqs) {
    if (sendBudget <= 0) { capped = true; break }
    const clientId = seq.client_id
    const clientStatus = statusById[clientId]
    if (clientStatus && clientStatus !== 'active') continue

    // One misconfigured client must never take down the whole run.
    try {
      const sendHour = numOr(seq.send_hour, 10)
      let clientSends = perClientBudget
      // P1: MAX_SENDS_PER_RUN only ever budgeted SUCCESSFUL SENDS. Every other
      // exit from the cart loop — step missing/disabled, template not
      // APPROVED, no BASE_URL for a body link, no link route on the template —
      // still spent a claim plus an update, and decremented nothing. A client
      // with 200 due carts and a pending template therefore did 400
      // subrequests while sendBudget sat at 80 and `capped` stayed false. A few
      // such clients at the same send hour clear Cloudflare's per-invocation
      // subrequest cap; fetch throws, the per-client catch below swallows it,
      // and the endpoint returns a healthy-looking {ok:true, sent:0}.
      // This budgets WORK, not just sends.
      let clientWork = perClientBudget * WORK_PER_SEND

      // 1) Expire stale open carts for this client (stop chasing dead carts).
      const expiryStart = new Date(nowMs - numOr(seq.expiry_days, 14) * DAY_MS).toISOString()
      const { data: expiredRows } = await sb.from('abandoned_carts')
        .update({ status: 'expired', next_step_at: null, updated_at: nowIso })
        .eq('client_id', clientId).eq('status', 'open').lt('abandoned_at', expiryStart)
        .select('id')
      expired += expiredRows?.length || 0

      // 2) Load this client's steps once — used by both the poll and the sends.
      const { data: steps } = await sb.from('cart_sequence_steps')
        .select('*').eq('client_id', clientId).order('step_no', { ascending: true })
      const stepRows = steps || []
      const stepByNo: Record<number, any> = {}
      stepRows.forEach(s => { stepByNo[s.step_no] = s })

      // 3) Best-effort Shopify polling fallback (see note above). Budgeted, and
      //    it reuses the context loaded at (2) instead of re-querying per cart.
      if (pollBudget > 0) {
        try {
          const n = await pollShopifyAbandonedCarts(
            clientId,
            { seq, steps: stepRows },
            Math.min(perClientPoll, pollBudget)
          )
          polled += n
          pollBudget -= n
        } catch (e) {
          console.error('[cart tick] shopify poll failed', { clientId, e: String(e) })
        }
      }

      // 4) WhatsApp must be connected to send anything.
      const config = await getWAConfig(clientId)
      if (!config) continue

      // 5) Templates. Keyed by name|language so the same template name in two
      //    languages can't collide (last-write-wins previously picked at random).
      //    `button_config` is needed too: `has_buttons` is true for ANY button
      //    (quick-reply, phone-number, static URL), and attaching a URL
      //    parameter to one of those makes Meta reject the whole send.
      //    `header_type` / `header_media_id` / `header_media_url` are needed
      //    too: a template with an IMAGE/VIDEO/DOCUMENT header REQUIRES a
      //    header component at send time. Without it Meta rejects the message
      //    ("parameters missing") — and cart-recovery templates are image-
      //    headed almost always, so those steps could never send at all.
      const { data: tmpls } = await sb.from('whatsapp_templates')
        .select('template_name, status, variable_count, language, has_buttons, button_config, header_type, header_media_id, header_media_url')
        .eq('client_id', clientId)
      const tmplByKey: Record<string, any> = {}
      const tmplByName: Record<string, any> = {}
      ;(tmpls || []).forEach(t => {
        tmplByKey[`${t.template_name}|${t.language}`] = t
        if (!tmplByName[t.template_name] || t.status === 'APPROVED') tmplByName[t.template_name] = t
      })

      // 6) Find due carts (opted-in, open, next step in the past, not finished).
      const { data: dueCarts } = await sb.from('abandoned_carts')
        .select('*')
        .eq('client_id', clientId).eq('status', 'open').eq('opted_in', true)
        .lt('last_step_sent', 3)
        .not('next_step_at', 'is', null)
        .lte('next_step_at', nowIso)
        .order('next_step_at', { ascending: true })
        .limit(MAX_DUE_CARTS_PER_CLIENT)

      // Push a cart to the next send hour without burning its step.
      //
      // CONDITIONAL on next_step_at, exactly like the send claim: this is now
      // the ONLY statement a held cart costs. It used to run after a separate
      // claim, so every hold was 2 subrequests. Two overlapping runs writing
      // the same hold timestamp is harmless, and the guard keeps a hold from
      // stomping on a claim another run has already taken.
      const holdCart = async (cart: any) => {
        held++
        await sb.from('abandoned_carts').update({
          next_step_at: nextSendInstant(nowIso, 1, sendHour),
          updated_at: nowIso,
        }).eq('id', cart.id).eq('status', 'open').eq('next_step_at', cart.next_step_at)
      }

      for (const cart of dueCarts || []) {
        if (sendBudget <= 0 || clientSends <= 0 || clientWork <= 0) { capped = true; break }
        processed++
        // Decrement BEFORE any branch. Every path below costs subrequests.
        clientWork--

        const stepNo = (cart.last_step_sent ?? 0) + 1
        const step = stepByNo[stepNo]

        // ── Everything from here to the claim is pure in-memory work. Deciding
        // whether this cart can send BEFORE claiming it means a hold costs one
        // statement instead of two, which is what keeps a client whose
        // templates are all pending from draining the invocation.

        // Step permanently missing or explicitly disabled → skip forward so the
        // sequence doesn't stall; try the next step on its own schedule.
        // (H5: recovery credit is read from cart_messages, so advancing
        // last_step_sent here no longer inflates per-message revenue.)
        if (!step || step.enabled === false) {
          const nextStep = stepByNo[stepNo + 1]
          const patch: Record<string, any> = { last_step_sent: stepNo, updated_at: nowIso }
          patch.next_step_at = (stepNo < 3 && nextStep && nextStep.enabled !== false)
            ? nextSendInstant(nowIso, numOr(nextStep.delay_days, 1), sendHour)
            : null
          if (!patch.next_step_at) patch.status = 'completed'
          // Conditional, so this is atomic without a preceding claim.
          await sb.from('abandoned_carts').update(patch)
            .eq('id', cart.id).eq('status', 'open').eq('next_step_at', cart.next_step_at)
          continue
        }

        // Template not APPROVED yet → HOLD, don't burn the step. Meta approval
        // is usually a matter of hours; treating "pending" as "broken" used to
        // walk carts through steps 1→3 with zero messages and zero logging.
        // The cart retries at the next send hour; expiry_days caps how long.
        const tmpl = tmplByKey[`${step.template_name}|${step.language || 'en'}`]
          || tmplByName[step.template_name]
        if (!tmpl || tmpl.status !== 'APPROVED') {
          warnings.add(`Template "${step.template_name}" is not APPROVED — messages are being held. If Meta has already approved it, run a template sync (WhatsApp → Templates → Sync).`)
          await holdCart(cart)
          continue
        }

        // Build the PER-CART tracking slug: `<step slug>.<cart id>`. The /r/
        // redirect splits on the first dot, resolves the step, and sends the
        // shopper to THEIR OWN cart's recovery_url (Shopify checkout resume),
        // via the /discount session URL when the step carries a coupon.
        const cartSlug = `${step.tracking_slug}.${cart.id}`
        const trackingLink = baseOk ? `${base}/r/${cartSlug}` : ''
        const varMap = step.variable_map || {}
        const variables: string[] = []
        let linkInBody = false
        for (let v = 1; v <= (tmpl.variable_count || 0); v++) {
          const key = varMap[`{{${v}}}`] || varMap[String(v)]
          if (key === '__name__') variables.push(cart.contact_name || 'there')
          else if (key === '__link__') { variables.push(trackingLink); linkInBody = true }
          else if (key === '__code__') variables.push(step.coupon_code || '')
          else variables.push(key || '')
        }

        // Meta rejects EMPTY body parameters outright, so an unmapped variable
        // (or __code__ on a step with no coupon) used to fail every send for
        // this step and silently retry it daily until the cart expired. A
        // single space is a valid parameter and keeps the message deliverable.
        for (let i = 0; i < variables.length; i++) {
          if (!variables[i].trim()) variables[i] = ' '
        }

        // M1: the body wants a link and we have no public origin to build one.
        // Sending would put "/r/…" in front of a customer AND bill us for it.
        if (linkInBody && !baseOk) {
          console.error('[cart tick] no BASE_URL — holding body-link send', { clientId, step: stepNo })
          await holdCart(cart)
          continue
        }

        // Where does the shopper's link actually live? Two valid answers:
        //   a) a DYNAMIC url button — base url ending in {{1}}, param = slug
        //   b) the message body — the `__link__` variable, full URL
        // `has_buttons` is true for quick-reply and phone-number buttons too,
        // and for static URL buttons that take no parameter; passing a URL
        // parameter to any of those makes Meta 400 the message. Find the real
        // one instead of assuming index 0.
        const urlButtonIndex = findDynamicUrlButtonIndex(tmpl.button_config)

        // Neither route available → the message would reach the shopper with no
        // way back to their cart, and we'd still be billed for it. Hold instead,
        // so the brand can fix the mapping; expiry_days caps the wait.
        if (urlButtonIndex < 0 && !linkInBody) {
          console.error('[cart tick] no link route on template', {
            clientId, step: stepNo, template: step.template_name,
          })
          warnings.add(`Template "${step.template_name}" has no dynamic URL button and no {{n}} mapped to the tracking link, so the shopper would have no way back to their cart. Map a variable to "Tracking link", or re-sync templates if the button was added on Meta.`)
          await holdCart(cart)
          continue
        }

        // ── This cart WILL send. Claim it now.
        // A conditional update that only matches if next_step_at is still what
        // we read. Two overlapping runs can't both pass this, so a cart can
        // never be double-sent. The claim moves next_step_at forward by a short
        // lease instead of nulling it — if this worker dies mid-send, the cart
        // becomes due again after the lease.
        //
        // Deliberately the LAST thing before the send: the hold/skip branches
        // above are idempotent and guard themselves, so they no longer pay for
        // a claim they were only going to overwrite.
        const lease = new Date(nowMs + CLAIM_LEASE_MS).toISOString()
        const { data: claimed } = await sb.from('abandoned_carts')
          .update({ next_step_at: lease, updated_at: nowIso })
          .eq('id', cart.id).eq('status', 'open').eq('next_step_at', cart.next_step_at)
          .select('id')
        if (!claimed || claimed.length === 0) continue // another run has it

        sendBudget--
        clientSends--
        const result = await sendTemplateMessage(config, {
          to: cart.phone,
          templateName: step.template_name,
          language: step.language || tmpl.language || 'en',
          variables,
          trackingUrl: cartSlug,
          urlButtonIndex,
          // Media-headed templates REQUIRE a header component. Without these
          // Meta rejects the send outright, and cart-recovery templates carry
          // an image header almost always.
          headerType: tmpl.header_type,
          headerMediaId: tmpl.header_media_id,
          headerMediaUrl: tmpl.header_media_url,
        })

        if ('error' in result) {
          failed++
          const { error: logErr } = await sb.from('cart_messages').insert({
            cart_id: cart.id, client_id: clientId, step_no: stepNo,
            phone: cart.phone, status: 'failed', error_message: result.error,
          })
          if (logErr) console.error('[cart tick] failed to log failed send', logErr.message)
          // Retry this same step at the next send hour rather than skipping it.
          await sb.from('abandoned_carts').update({
            next_step_at: nextSendInstant(nowIso, 1, sendHour),
            updated_at: nowIso,
          }).eq('id', cart.id)
          continue
        }

        sent++
        // M5/H5: this row is the source of truth for "which message actually
        // reached the shopper", both for the funnel and for recovery credit —
        // so a write failure here has to be visible, not swallowed.
        const { error: logErr } = await sb.from('cart_messages').insert({
          cart_id: cart.id, client_id: clientId, step_no: stepNo,
          wa_message_id: result.wa_message_id, phone: cart.phone, status: 'sent',
        })
        if (logErr) console.error('[cart tick] failed to log sent message', {
          clientId, cartId: cart.id, step: stepNo, error: logErr.message,
        })

        // Advance: schedule the next enabled step, or complete after step 3.
        const nextStep = stepByNo[stepNo + 1]
        const patch: Record<string, any> = { last_step_sent: stepNo, updated_at: nowIso }
        if (stepNo < 3 && nextStep && nextStep.enabled !== false) {
          patch.next_step_at = nextSendInstant(nowIso, numOr(nextStep.delay_days, 1), sendHour)
        } else {
          patch.next_step_at = null
          patch.status = 'completed'
        }
        await sb.from('abandoned_carts').update(patch).eq('id', cart.id)
      }
    } catch (e) {
      console.error('[cart tick] client failed', { clientId, e: String(e) })
    }
  }

  return { processed, sent, failed, expired, held, polled, capped, warnings: Array.from(warnings) }
}

// ── KPIs: the funnel + total revenue generated by this activity ──────────────
export interface CartStats {
  detected: number
  messageable: number             // opted-in carts we could actually chase
  recovered: number               // any cart that turned into a purchase
  recoveredByMessage: number      // recovered while a message (step 1-3) was live
  recoveredBeforeMessage: number  // bought before any message went (organic)
  totalRevenue: number            // ⭐ revenue attributable to this activity (steps 1-3)
  organicRevenue: number          // recovered_by_step = 0
  recoveryRate: string            // recovered / detected, %
  /** Carts we hold no phone for — detected, but never messageable. */
  unreachable: number
  /** True when the cohort was too large to count per-step sends exactly. */
  sentApproximate: boolean
  steps: {
    step: number
    sent: number
    recovered: number
    revenue: number
    recoveryRate: string          // recovered / sent, %
  }[]
}

// month = 'YYYY-MM' (optional). Buckets by abandoned_at in IST, matching the
// dashboard's month windowing. Paginated — the previous unbounded select
// silently froze every KPI at PostgREST's 1,000-row cap.
export async function getCartAbandonmentStats(clientId: string, month?: string): Promise<CartStats> {
  const sb = getSupabaseAdmin()

  let start: string | null = null, end: string | null = null
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [my, mm] = month.split('-').map(Number)
    const nextMonth = new Date(Date.UTC(my, mm, 1)).toISOString().slice(0, 10)
    start = new Date(`${month}-01T00:00:00+05:30`).toISOString()
    end = new Date(`${nextMonth}T00:00:00+05:30`).toISOString()
  }

  const rows = await pageAll<any>((from, to) => {
    let q = sb.from('abandoned_carts')
      .select('id, phone, status, opted_in, recovered_by_step, recovered_value')
      .eq('client_id', clientId).order('abandoned_at', { ascending: true }).range(from, to)
    if (start && end) q = q.gte('abandoned_at', start).lt('abandoned_at', end)
    return q
  })

  const detected = rows.length
  // M2: email-only carts are now stored, so "messageable" has to mean
  // reachable AND consented, not just consented.
  const messageable = rows.filter(r => r.opted_in && r.phone).length
  const unreachable = rows.filter(r => !r.phone).length
  const recoveredRows = rows.filter(r => r.status === 'recovered')
  const recovered = recoveredRows.length
  const byMsg = recoveredRows.filter(r => (r.recovered_by_step ?? 0) >= 1)
  const recoveredByMessage = byMsg.length
  const recoveredBeforeMessage = recoveredRows.filter(r => (r.recovered_by_step ?? 0) === 0).length
  const totalRevenue = byMsg.reduce((s, r) => s + (Number(r.recovered_value) || 0), 0)
  const organicRevenue = recoveredRows
    .filter(r => (r.recovered_by_step ?? 0) === 0)
    .reduce((s, r) => s + (Number(r.recovered_value) || 0), 0)

  // M7: per-step "sent" counted for THIS COHORT's carts. The old version
  // filtered cart_messages by created_at, so a message sent on 1 Aug for a cart
  // abandoned on 30 Jul landed in the wrong month and the per-step recovery
  // rates compared two different populations.
  const sentByStep: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  const ids = rows.map(r => r.id)
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += STATS_COHORT_CHUNK) {
    chunks.push(ids.slice(i, i + STATS_COHORT_CHUNK))
  }
  const usable = chunks.slice(0, STATS_MAX_COHORT_CHUNKS)
  const sentApproximate = chunks.length > usable.length
  for (const chunk of usable) {
    const { data } = await sb.from('cart_messages')
      .select('step_no, status').in('cart_id', chunk)
    for (const m of data || []) {
      if (m.status !== 'failed') sentByStep[m.step_no] = (sentByStep[m.step_no] || 0) + 1
    }
  }

  const steps = [1, 2, 3].map(n => {
    const recoveredN = byMsg.filter(r => r.recovered_by_step === n)
    const revN = recoveredN.reduce((s, r) => s + (Number(r.recovered_value) || 0), 0)
    const sentN = sentByStep[n] || 0
    return {
      step: n,
      sent: sentN,
      recovered: recoveredN.length,
      revenue: revN,
      recoveryRate: sentN > 0 ? ((recoveredN.length / sentN) * 100).toFixed(1) : '0',
    }
  })

  return {
    detected,
    messageable,
    recovered,
    recoveredByMessage,
    recoveredBeforeMessage,
    totalRevenue,
    organicRevenue,
    recoveryRate: detected > 0 ? ((recovered / detected) * 100).toFixed(1) : '0',
    unreachable,
    sentApproximate,
    steps,
  }
}
