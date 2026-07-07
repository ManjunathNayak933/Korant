// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/cart-abandonment.ts   (NEW FILE)                            │
// │ Create at <repo-root>/lib/cart-abandonment.ts                              │
// │                                                                            │
// │ The engine behind the Cart Abandonment tab. Platform-neutral: it never     │
// │ talks to Shopify directly. Adapters (Shopify checkout webhook, generic     │
// │ webhook, storefront snippet) all call intakeAbandonedCart() with the same  │
// │ normalised shape. The daily cron calls runCartAbandonmentTick(). Order     │
// │ webhooks call recoverCartsForOrder() to stop the sequence + attribute.     │
// └──────────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'
import { getWAConfig, sendTemplateMessage } from './whatsapp'

// ── Phone normalisation ─────────────────────────────────────────────────────
// Mirrors app/api/whatsapp/contacts: strip non-digits, default a bare 10-digit
// number to India (+91). Returns '' if there aren't enough digits to be valid.
export function normalizePhone(raw: string | null | undefined): string {
  let p = String(raw || '').replace(/\D/g, '')
  if (!p) return ''
  if (p.length === 10) p = `91${p}`
  return p.length >= 10 ? p : ''
}

// ── Scheduling: next send instant at the brand's chosen wall-clock hour ──────
// Given a base instant, add `delayDays`, then snap the time-of-day to `sendHour`
// in `timezone`. If the resulting instant is not strictly after base (e.g. delay
// 0 and the hour already passed today), roll to the next day. No date library —
// uses Intl to resolve the timezone offset (two passes to stay correct across
// DST for zones that have it; IST has none so it's exact).
export function nextSendInstant(
  baseIso: string, delayDays: number, sendHour: number, timezone: string
): string {
  const base = new Date(baseIso)
  const target = new Date(base.getTime() + Math.max(0, delayDays) * 86400000)

  // Wall-clock Y-M-D of the target day, in the brand's timezone.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(target) // "YYYY-MM-DD"
  const [y, m, d] = ymd.split('-').map(Number)

  const instantForHour = (year: number, mon: number, day: number, hour: number): Date => {
    let guess = Date.UTC(year, mon - 1, day, hour, 0, 0)
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(new Date(guess))
      const map: Record<string, string> = {}
      parts.forEach(p => { map[p.type] = p.value })
      const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day,
        +map.hour === 24 ? 0 : +map.hour, +map.minute, +map.second)
      const offset = asUTC - guess
      guess = guess - offset
    }
    return new Date(guess)
  }

  let send = instantForHour(y, m, d, sendHour)
  if (send.getTime() <= base.getTime()) {
    const next = new Date(target.getTime() + 86400000)
    const ymd2 = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(next)
    const [y2, m2, d2] = ymd2.split('-').map(Number)
    send = instantForHour(y2, m2, d2, sendHour)
  }
  return send.toISOString()
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

  // Load the sequence so we can (a) decide whether to schedule and (b) compute
  // the first step's due time.
  const { data: seq } = await sb
    .from('cart_sequences').select('*').eq('client_id', input.clientId).maybeSingle()
  const { data: step1 } = await sb
    .from('cart_sequence_steps')
    .select('delay_days, enabled').eq('client_id', input.clientId).eq('step_no', 1).maybeSingle()

  const canSchedule = !!(seq?.enabled && step1?.enabled && (input.optedIn ?? false))
  const nowIso = new Date().toISOString()
  const nextStepAt = canSchedule
    ? nextSendInstant(nowIso, step1!.delay_days ?? 1, seq!.send_hour ?? 10, seq!.timezone || 'Asia/Kolkata')
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
      .select('id, last_step_sent, status')
      .eq('client_id', input.clientId).eq('external_id', input.externalId).maybeSingle()

    if (existing) {
      if (existing.status !== 'open') return { stored: true, cartId: existing.id, scheduled: false }
      const patch: Record<string, any> = {
        cart_value: row.cart_value, currency: row.currency, item_count: row.item_count,
        cart_items: row.cart_items, recovery_url: row.recovery_url,
        phone, email, contact_name: row.contact_name, opted_in: row.opted_in,
        updated_at: nowIso,
      }
      // Only (re)schedule if it hasn't sent anything yet.
      if ((existing.last_step_sent ?? 0) === 0) patch.next_step_at = nextStepAt
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
// Called from order webhooks (Shopify orders/paid, generic order webhook, etc.).
// Matches by phone or email against this client's OPEN carts within the expiry
// window, credits the most recent match, and stops every other open cart for the
// same buyer so we don't keep messaging someone who already bought.
export async function recoverCartsForOrder(input: {
  clientId: string
  phone?: string | null
  email?: string | null
  orderId: string
  orderValue: number
}): Promise<{ recovered: number; step?: number | null }> {
  const sb = getSupabaseAdmin()
  const phone = normalizePhone(input.phone)
  const email = (input.email || '').trim().toLowerCase() || null
  if (!phone && !email) return { recovered: 0 }

  const { data: seq } = await sb
    .from('cart_sequences').select('expiry_days').eq('client_id', input.clientId).maybeSingle()
  const windowStart = new Date(Date.now() - (seq?.expiry_days ?? 14) * 86400000).toISOString()

  // Build an OR filter across phone/email.
  let q = sb.from('abandoned_carts')
    .select('id, last_step_sent, abandoned_at')
    .eq('client_id', input.clientId).eq('status', 'open')
    .gte('abandoned_at', windowStart)
    .order('abandoned_at', { ascending: false })

  const ors: string[] = []
  if (phone) ors.push(`phone.eq.${phone}`)
  if (email) ors.push(`email.eq.${email}`)
  q = q.or(ors.join(','))

  const { data: carts } = await q
  if (!carts?.length) return { recovered: 0 }

  const primary = carts[0]
  const step = primary.last_step_sent ?? 0
  const nowIso = new Date().toISOString()

  await sb.from('abandoned_carts').update({
    status: 'recovered',
    recovered_at: nowIso,
    recovered_order_id: input.orderId,
    recovered_value: input.orderValue || 0,
    recovered_by_step: step,           // 0 = recovered before any message went out
    updated_at: nowIso,
  }).eq('id', primary.id)

  // Stop any other open carts for the same buyer (no double revenue credit).
  const others = carts.slice(1).map(c => c.id)
  if (others.length) {
    await sb.from('abandoned_carts').update({ status: 'completed', updated_at: nowIso }).in('id', others)
  }

  return { recovered: carts.length, step }
}

// ── The daily tick: send whichever step is now due for each open cart ─────────
export async function runCartAbandonmentTick(
  nowIso = new Date().toISOString()
): Promise<{ processed: number; sent: number; failed: number; expired: number }> {
  const sb = getSupabaseAdmin()
  let processed = 0, sent = 0, failed = 0, expired = 0

  // Only clients with an enabled sequence are in play.
  const { data: seqs } = await sb.from('cart_sequences').select('*').eq('enabled', true)
  if (!seqs?.length) return { processed, sent, failed, expired }

  for (const seq of seqs) {
    const clientId = seq.client_id

    // 1) Expire stale open carts for this client (stop chasing dead carts).
    const expiryStart = new Date(Date.now() - (seq.expiry_days ?? 14) * 86400000).toISOString()
    const { data: expiredRows } = await sb.from('abandoned_carts')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('client_id', clientId).eq('status', 'open').lt('abandoned_at', expiryStart)
      .select('id')
    expired += expiredRows?.length || 0

    // 2) WhatsApp must be connected to send anything.
    const config = await getWAConfig(clientId)
    if (!config) continue

    // 3) Load this client's steps once.
    const { data: steps } = await sb.from('cart_sequence_steps')
      .select('*').eq('client_id', clientId).order('step_no', { ascending: true })
    const stepByNo: Record<number, any> = {}
    ;(steps || []).forEach(s => { stepByNo[s.step_no] = s })

    // 4) Templates must be APPROVED to send. Cache per client.
    const { data: tmpls } = await sb.from('whatsapp_templates')
      .select('template_name, status, variable_count, language').eq('client_id', clientId)
    const tmplByName: Record<string, any> = {}
    ;(tmpls || []).forEach(t => { tmplByName[t.template_name] = t })

    // 5) Find due carts (opted-in, open, next step in the past, not finished).
    const { data: dueCarts } = await sb.from('abandoned_carts')
      .select('*')
      .eq('client_id', clientId).eq('status', 'open').eq('opted_in', true)
      .lt('last_step_sent', 3)
      .not('next_step_at', 'is', null)
      .lte('next_step_at', nowIso)
      .order('next_step_at', { ascending: true })
      .limit(500)

    for (const cart of dueCarts || []) {
      processed++
      const stepNo = (cart.last_step_sent ?? 0) + 1
      const step = stepByNo[stepNo]
      const tmpl = step ? tmplByName[step.template_name] : null

      // Step disabled / missing / template not approved → skip forward so the
      // sequence doesn't stall on a broken step; try the next step next run.
      if (!step || !step.enabled || !tmpl || tmpl.status !== 'APPROVED') {
        const nextStep = stepByNo[stepNo + 1]
        const patch: Record<string, any> = { last_step_sent: stepNo, updated_at: nowIso }
        patch.next_step_at = (stepNo < 3 && nextStep?.enabled)
          ? nextSendInstant(nowIso, nextStep.delay_days ?? 1, seq.send_hour ?? 10, seq.timezone || 'Asia/Kolkata')
          : null
        if (!patch.next_step_at) patch.status = 'completed'
        await sb.from('abandoned_carts').update(patch).eq('id', cart.id)
        continue
      }

      // Build positional variables from the step's variable_map, exactly like the
      // campaign sender. __link__ uses THIS step's tracking slug in the body; the
      // URL button gets the raw slug (base/{{1}} is built at template level).
      const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL}/r/${step.tracking_slug}`
      const varMap = step.variable_map || {}
      const variables: string[] = []
      for (let v = 1; v <= (tmpl.variable_count || 0); v++) {
        const key = varMap[`{{${v}}}`] || varMap[String(v)]
        if (key === '__name__') variables.push(cart.contact_name || 'there')
        else if (key === '__link__') variables.push(trackingLink)
        else if (key === '__code__') variables.push(step.coupon_code || '')
        else variables.push(key || '')
      }

      const result = await sendTemplateMessage(config, {
        to: cart.phone,
        templateName: step.template_name,
        language: step.language || tmpl.language || 'en',
        variables,
        trackingUrl: step.tracking_slug,
      })

      if ('error' in result) {
        failed++
        await sb.from('cart_messages').insert({
          cart_id: cart.id, client_id: clientId, step_no: stepNo,
          phone: cart.phone, status: 'failed', error_message: result.error,
        })
        // Retry this same step on the next daily run rather than skipping it.
        await sb.from('abandoned_carts').update({
          next_step_at: nextSendInstant(nowIso, 1, seq.send_hour ?? 10, seq.timezone || 'Asia/Kolkata'),
          updated_at: nowIso,
        }).eq('id', cart.id)
        continue
      }

      sent++
      await sb.from('cart_messages').insert({
        cart_id: cart.id, client_id: clientId, step_no: stepNo,
        wa_message_id: result.wa_message_id, phone: cart.phone, status: 'sent',
      })

      // Advance: schedule the next step, or complete the sequence after step 3.
      const nextStep = stepByNo[stepNo + 1]
      const patch: Record<string, any> = { last_step_sent: stepNo, updated_at: nowIso }
      if (stepNo < 3 && nextStep?.enabled) {
        patch.next_step_at = nextSendInstant(nowIso, nextStep.delay_days ?? 1, seq.send_hour ?? 10, seq.timezone || 'Asia/Kolkata')
      } else {
        patch.next_step_at = null
        patch.status = 'completed'
      }
      await sb.from('abandoned_carts').update(patch).eq('id', cart.id)
    }
  }

  return { processed, sent, failed, expired }
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
// dashboard's month windowing.
export async function getCartAbandonmentStats(clientId: string, month?: string): Promise<CartStats> {
  const sb = getSupabaseAdmin()

  let start: string | null = null, end: string | null = null
  if (month) {
    const [my, mm] = month.split('-').map(Number)
    const nextMonth = new Date(Date.UTC(my, mm, 1)).toISOString().slice(0, 10)
    start = new Date(`${month}-01T00:00:00+05:30`).toISOString()
    end = new Date(`${nextMonth}T00:00:00+05:30`).toISOString()
  }

  const cartQ = () => {
    let q = sb.from('abandoned_carts').select('*').eq('client_id', clientId)
    if (start && end) q = q.gte('abandoned_at', start).lt('abandoned_at', end)
    return q
  }
  const { data: carts } = await cartQ()
  const rows = carts || []

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

  // Per-step "sent" comes from the message log (accurate even after a cart moves
  // on); "recovered"/"revenue" come from recovered_by_step on the cart.
  let mq = sb.from('cart_messages').select('step_no, status, created_at').eq('client_id', clientId)
  if (start && end) mq = mq.gte('created_at', start).lt('created_at', end)
  const { data: msgs } = await mq
  const sentByStep: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  ;(msgs || []).forEach(m => {
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
