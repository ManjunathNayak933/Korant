// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/cart-abandonment.ts                                        │
// │                                                                            │
// │ The engine behind the Cart Abandonment tab. Platform-neutral: adapters    │
// │ (Shopify checkout webhook, GraphQL abandonedCheckouts polling, generic     │
// │ webhook, storefront snippet) all call intakeAbandonedCart() with the same  │
// │ normalised shape. The hourly cron calls runCartAbandonmentTick(). Order    │
// │ webhooks call recoverCartsForOrder() to stop the sequence + attribute.     │
// │                                                                            │
// │ ALL SCHEDULING IS IST (Asia/Kolkata, UTC+05:30). IST has no DST, so the   │
// │ wall-clock math is exact integer arithmetic — no Intl, nothing can throw. │
// └──────────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'
import { getWAConfig, sendTemplateMessage, findDynamicUrlButtonIndex } from './whatsapp'
import { fetchShopifyAbandonedCheckouts } from './shopify'

// ── Constants ───────────────────────────────────────────────────────────────
export const IST_TIMEZONE = 'Asia/Kolkata'
const IST_OFFSET_MS = 5.5 * 3600000       // UTC+05:30, fixed — India has no DST
const DAY_MS = 86400000

// Safety budgets for one cron invocation (Cloudflare caps subrequests per
// invocation — 1,000 on paid plans). Each send costs ~4 subrequests, so 80
// sends + per-client overhead stays comfortably under the cap. Anything left
// over is picked up by the next hourly run (carts stay claimed-and-due).
const MAX_SENDS_PER_RUN = 80
const MAX_DUE_CARTS_PER_CLIENT = 200
// A claimed cart that crashes mid-send self-heals after this lease expires.
const CLAIM_LEASE_MS = 2 * 3600000

// ── Phone normalisation ─────────────────────────────────────────────────────
// Strip non-digits, default a bare 10-digit number to India (+91).
export function normalizePhone(raw: string | null | undefined): string {
  let p = String(raw || '').replace(/\D/g, '')
  if (!p) return ''
  if (p.length === 10) p = `91${p}`
  return p.length >= 10 ? p : ''
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

// ── Intake: store/refresh one abandoned cart from any source ─────────────────
export interface CartIntake {
  clientId: string
  phone?: string | null
  email?: string | null
  name?: string | null
  optedIn?: boolean
  identitySource?: 'logged_in' | 'checkout' | 'known_visitor'
  cartValue?: number
  currency?: string
  items?: { title?: string; qty?: number; price?: number }[]
  recoveryUrl?: string | null
  source?: string
  externalId?: string | null
}

export async function intakeAbandonedCart(
  input: CartIntake
): Promise<{ stored: boolean; cartId?: string; scheduled?: boolean; reason?: string }> {
  const sb = getSupabaseAdmin()
  const phone = normalizePhone(input.phone)
  const email = (input.email || '').trim().toLowerCase() || null

  // No phone → not messageable on WhatsApp. We don't store an unreachable cart.
  if (!phone) return { stored: false, reason: 'no_phone' }

  // Load the sequence + steps so we can decide whether to schedule and compute
  // the FIRST ENABLED step's due time (disabling message 1 no longer silently
  // kills the whole sequence — we start from whichever step is enabled first).
  const [{ data: seq }, { data: steps }] = await Promise.all([
    sb.from('cart_sequences').select('*').eq('client_id', input.clientId).maybeSingle(),
    sb.from('cart_sequence_steps').select('step_no, delay_days, enabled')
      .eq('client_id', input.clientId).order('step_no', { ascending: true }),
  ])

  const startStep = firstEnabledStep(steps || [])
  const canSchedule = !!(seq?.enabled && startStep && (input.optedIn ?? false))
  const nowIso = new Date().toISOString()
  const nextStepAt = canSchedule
    ? nextSendInstant(nowIso, numOr(startStep.delay_days, 1), numOr(seq!.send_hour, 10))
    : null

  const items = input.items || []
  const row: Record<string, any> = {
    client_id: input.clientId,
    phone,
    email,
    contact_name: input.name || null,
    identity_source: input.identitySource || 'checkout',
    opted_in: input.optedIn ?? false,
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
    next_step_at: nextStepAt,
    abandoned_at: nowIso,
    updated_at: nowIso,
  }

  // Upsert on the source's own id when we have one, so repeated "checkout
  // updated" webhooks refresh the same cart instead of creating duplicates. We
  // deliberately DON'T reset last_step_sent on update (a later webhook must not
  // rewind an in-flight sequence), so only set schedule fields on first insert.
  if (input.externalId) {
    const { data: existing } = await sb
      .from('abandoned_carts')
      .select('id, last_step_sent, status, recovery_url')
      .eq('client_id', input.clientId).eq('external_id', input.externalId).maybeSingle()

    if (existing) {
      if (existing.status !== 'open') return { stored: true, cartId: existing.id, scheduled: false }
      const patch: Record<string, any> = {
        cart_value: row.cart_value, currency: row.currency, item_count: row.item_count,
        cart_items: row.cart_items,
        recovery_url: row.recovery_url || existing.recovery_url,
        phone, email, contact_name: row.contact_name, opted_in: row.opted_in,
        updated_at: nowIso,
      }
      // Only (re)schedule if nothing has been sent yet — and ONLY when the new
      // schedule is non-null. A later webhook that momentarily lacks consent
      // fields must not un-schedule an already-scheduled cart.
      if ((existing.last_step_sent ?? 0) === 0 && nextStepAt) patch.next_step_at = nextStepAt
      await sb.from('abandoned_carts').update(patch).eq('id', existing.id)
      return { stored: true, cartId: existing.id, scheduled: !!nextStepAt }
    }
  }

  const { data: inserted, error } = await sb
    .from('abandoned_carts').insert(row).select('id').single()
  if (error) return { stored: false, reason: error.message }
  return { stored: true, cartId: inserted.id, scheduled: !!nextStepAt }
}

// ── Recovery: a purchase arrived — stop the sequence + attribute the sale ─────
// Called from order webhooks (Shopify orders/paid, generic, Razorpay). Matches
// FIRST by the checkout's own external id (exact — Shopify orders carry
// checkout_token, which is what intake stored), then by phone/email against
// this client's OPEN carts within the expiry window. Phone/email matching runs
// as separate parameterised queries — no string-built OR filter, so a crafted
// email can no longer inject PostgREST filter syntax.
export async function recoverCartsForOrder(input: {
  clientId: string
  phone?: string | null
  email?: string | null
  orderId: string
  orderValue: number
  externalId?: string | null   // e.g. Shopify order.checkout_token
}): Promise<{ recovered: number; step?: number | null }> {
  const sb = getSupabaseAdmin()
  const phone = normalizePhone(input.phone)
  const email = (input.email || '').trim().toLowerCase() || null
  const externalId = (input.externalId || '').trim() || null
  if (!phone && !email && !externalId) return { recovered: 0 }

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
  if (externalId) {
    const { data } = await sb.from('abandoned_carts')
      .select('id, last_step_sent, abandoned_at, status')
      .eq('client_id', input.clientId).in('status', RECOVERABLE).eq('external_id', externalId)
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
  const step = primary.last_step_sent ?? 0
  const nowIso = new Date().toISOString()

  await sb.from('abandoned_carts').update({
    status: 'recovered',
    recovered_at: nowIso,
    recovered_order_id: input.orderId,
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

// ── Shopify polling fallback ─────────────────────────────────────────────────
// Belt-and-braces alongside the CHECKOUTS_CREATE/UPDATE webhooks: the GraphQL
// Admin `abandonedCheckouts` query (2026-07) returns every checkout where the
// shopper entered contact details but didn't pay — including stores on Checkout
// Extensibility where webhook delivery has historically been patchy. Fully
// external checkouts (GoKwik-style) never reach Shopify at all; those use the
// platform-neutral /api/webhook/cart endpoint instead.
async function pollShopifyAbandonedCarts(clientId: string): Promise<number> {
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString() // last 24h
  const checkouts = await fetchShopifyAbandonedCheckouts(clientId, sinceIso)
  let stored = 0
  for (const c of checkouts) {
    const r = await intakeAbandonedCart({
      clientId,
      phone: c.phone,
      email: c.email,
      name: c.name,
      optedIn: c.optedIn,
      identitySource: 'checkout',
      cartValue: c.totalPrice,
      currency: c.currency,
      items: c.items,
      recoveryUrl: c.recoveryUrl,
      source: 'shopify',
      externalId: c.externalId,
    })
    if (r.stored) stored++
  }
  return stored
}

// ── The hourly tick: send whichever step is now due for each open cart ────────
export async function runCartAbandonmentTick(
  nowIso = new Date().toISOString()
): Promise<{ processed: number; sent: number; failed: number; expired: number; held: number; capped: boolean }> {
  const sb = getSupabaseAdmin()
  const nowMs = new Date(nowIso).getTime()
  let processed = 0, sent = 0, failed = 0, expired = 0, held = 0
  let capped = false
  let sendBudget = MAX_SENDS_PER_RUN

  // Only clients with an enabled sequence are in play (paginated — the 1,000
  // row PostgREST cap must not silently drop clients past it).
  const seqs = await pageAll<any>((from, to) =>
    sb.from('cart_sequences').select('*').eq('enabled', true).range(from, to))
  if (!seqs.length) return { processed, sent, failed, expired, held, capped }

  // Paused / suspended clients must not keep messaging customers (or accruing
  // Meta charges). Fetch statuses in chunks and skip anything not active.
  const statusById: Record<string, string> = {}
  const ids = seqs.map(s => s.client_id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('clients').select('id, status').in('id', ids.slice(i, i + 200))
    for (const c of data || []) statusById[c.id] = c.status
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || ''

  for (const seq of seqs) {
    if (sendBudget <= 0) { capped = true; break }
    const clientId = seq.client_id
    const clientStatus = statusById[clientId]
    if (clientStatus && clientStatus !== 'active') continue

    // One misconfigured client must never take down the whole run.
    try {
      const sendHour = numOr(seq.send_hour, 10)

      // 1) Expire stale open carts for this client (stop chasing dead carts).
      const expiryStart = new Date(nowMs - numOr(seq.expiry_days, 14) * DAY_MS).toISOString()
      const { data: expiredRows } = await sb.from('abandoned_carts')
        .update({ status: 'expired', next_step_at: null, updated_at: nowIso })
        .eq('client_id', clientId).eq('status', 'open').lt('abandoned_at', expiryStart)
        .select('id')
      expired += expiredRows?.length || 0

      // 2) Best-effort Shopify polling fallback (see note above).
      try { await pollShopifyAbandonedCarts(clientId) } catch (e) {
        console.error('[cart tick] shopify poll failed', { clientId, e: String(e) })
      }

      // 3) WhatsApp must be connected to send anything.
      const config = await getWAConfig(clientId)
      if (!config) continue

      // 4) Load this client's steps once.
      const { data: steps } = await sb.from('cart_sequence_steps')
        .select('*').eq('client_id', clientId).order('step_no', { ascending: true })
      const stepByNo: Record<number, any> = {}
      ;(steps || []).forEach(s => { stepByNo[s.step_no] = s })

      // 5) Templates. Keyed by name|language so the same template name in two
      //    languages can't collide (last-write-wins previously picked at random).
      //    `button_config` is needed too: `has_buttons` is true for ANY button
      //    (quick-reply, phone-number, static URL), and attaching a URL
      //    parameter to one of those makes Meta reject the whole send.
      const { data: tmpls } = await sb.from('whatsapp_templates')
        .select('template_name, status, variable_count, language, has_buttons, button_config')
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

      for (const cart of dueCarts || []) {
        if (sendBudget <= 0) { capped = true; break }
        processed++

        // CLAIM the cart before sending: a conditional update that only matches
        // if next_step_at is still what we read. Two overlapping runs can't both
        // pass this, so a cart can never be double-sent. The claim moves
        // next_step_at forward by a short lease instead of nulling it — if this
        // worker dies mid-send, the cart becomes due again after the lease.
        const lease = new Date(nowMs + CLAIM_LEASE_MS).toISOString()
        const { data: claimed } = await sb.from('abandoned_carts')
          .update({ next_step_at: lease, updated_at: nowIso })
          .eq('id', cart.id).eq('status', 'open').eq('next_step_at', cart.next_step_at)
          .select('id')
        if (!claimed || claimed.length === 0) continue // another run has it

        const stepNo = (cart.last_step_sent ?? 0) + 1
        const step = stepByNo[stepNo]

        // Step permanently missing or explicitly disabled → skip forward so the
        // sequence doesn't stall; try the next step on its own schedule.
        if (!step || step.enabled === false) {
          const nextStep = stepByNo[stepNo + 1]
          const patch: Record<string, any> = { last_step_sent: stepNo, updated_at: nowIso }
          patch.next_step_at = (stepNo < 3 && nextStep && nextStep.enabled !== false)
            ? nextSendInstant(nowIso, numOr(nextStep.delay_days, 1), sendHour)
            : null
          if (!patch.next_step_at) patch.status = 'completed'
          await sb.from('abandoned_carts').update(patch).eq('id', cart.id)
          continue
        }

        // Template not APPROVED yet → HOLD, don't burn the step. Meta approval
        // is usually a matter of hours; treating "pending" as "broken" used to
        // walk carts through steps 1→3 with zero messages and zero logging.
        // The cart retries at the next send hour; expiry_days caps how long.
        const tmpl = tmplByKey[`${step.template_name}|${step.language || 'en'}`]
          || tmplByName[step.template_name]
        if (!tmpl || tmpl.status !== 'APPROVED') {
          held++
          await sb.from('abandoned_carts').update({
            next_step_at: nextSendInstant(nowIso, 1, sendHour),
            updated_at: nowIso,
          }).eq('id', cart.id)
          continue
        }

        // Build the PER-CART tracking slug: `<step slug>.<cart id>`. The /r/
        // redirect splits on the first dot, resolves the step, and sends the
        // shopper to THEIR OWN cart's recovery_url (Shopify checkout resume),
        // via the /discount session URL when the step carries a coupon.
        const cartSlug = `${step.tracking_slug}.${cart.id}`
        const trackingLink = `${base}/r/${cartSlug}`
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
          held++
          console.error('[cart tick] no link route on template', {
            clientId, step: stepNo, template: step.template_name,
          })
          await sb.from('abandoned_carts').update({
            next_step_at: nextSendInstant(nowIso, 1, sendHour),
            updated_at: nowIso,
          }).eq('id', cart.id)
          continue
        }

        sendBudget--
        const result = await sendTemplateMessage(config, {
          to: cart.phone,
          templateName: step.template_name,
          language: step.language || tmpl.language || 'en',
          variables,
          trackingUrl: cartSlug,
          urlButtonIndex,
        })

        if ('error' in result) {
          failed++
          await sb.from('cart_messages').insert({
            cart_id: cart.id, client_id: clientId, step_no: stepNo,
            phone: cart.phone, status: 'failed', error_message: result.error,
          })
          // Retry this same step at the next send hour rather than skipping it.
          await sb.from('abandoned_carts').update({
            next_step_at: nextSendInstant(nowIso, 1, sendHour),
            updated_at: nowIso,
          }).eq('id', cart.id)
          continue
        }

        sent++
        await sb.from('cart_messages').insert({
          cart_id: cart.id, client_id: clientId, step_no: stepNo,
          wa_message_id: result.wa_message_id, phone: cart.phone, status: 'sent',
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

  return { processed, sent, failed, expired, held, capped }
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
      .select('status, opted_in, recovered_by_step, recovered_value')
      .eq('client_id', clientId).order('abandoned_at', { ascending: true }).range(from, to)
    if (start && end) q = q.gte('abandoned_at', start).lt('abandoned_at', end)
    return q
  })

  const detected = rows.length
  const messageable = rows.filter(r => r.opted_in).length
  const recoveredRows = rows.filter(r => r.status === 'recovered')
  const recovered = recoveredRows.length
  const byMsg = recoveredRows.filter(r => (r.recovered_by_step ?? 0) >= 1)
  const recoveredByMessage = byMsg.length
  const recoveredBeforeMessage = recoveredRows.filter(r => (r.recovered_by_step ?? 0) === 0).length
  const totalRevenue = byMsg.reduce((s, r) => s + (Number(r.recovered_value) || 0), 0)
  const organicRevenue = recoveredRows
    .filter(r => (r.recovered_by_step ?? 0) === 0)
    .reduce((s, r) => s + (Number(r.recovered_value) || 0), 0)

  // Per-step "sent" from the message log (accurate even after a cart moves on);
  // "recovered"/"revenue" from recovered_by_step on the cart. Also paginated.
  const msgs = await pageAll<any>((from, to) => {
    let q = sb.from('cart_messages').select('step_no, status')
      .eq('client_id', clientId).order('created_at', { ascending: true }).range(from, to)
    if (start && end) q = q.gte('created_at', start).lt('created_at', end)
    return q
  })
  const sentByStep: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  msgs.forEach(m => {
    if (m.status !== 'failed') sentByStep[m.step_no] = (sentByStep[m.step_no] || 0) + 1
  })

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
    steps,
  }
}
