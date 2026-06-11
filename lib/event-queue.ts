import { getSupabaseAdmin } from './supabase'

// ─── Tier B: edge event queue ────────────────────────────────────────────────
// The beacon (and any other hot-path tracker) no longer writes to Postgres
// synchronously. Instead it enqueues a compact event onto a Cloudflare Queue.
// A separate consumer Worker (see worker/event-consumer) drains the queue in
// batches and does the actual DB writes — collapsing ~450M individual pageview
// writes into a few thousand batched operations.
//
// SAFETY: if the TRACK_QUEUE binding is absent (e.g. Queue not provisioned yet,
// or local dev), enqueueEvent() returns false and the caller falls back to the
// existing direct-write path. Nothing breaks if you deploy this before wiring
// the queue.

export interface TrackEvent {
  v: 1                              // schema version, so the consumer can evolve
  kind: 'pageview' | 'purchase'     // what happened
  clientId: string
  visitorId: string
  channel: string                   // organic | social | email | direct
  entrySource: string               // organic_search | social | email | referral | direct
  page?: string
  ts: string                        // ISO timestamp captured at the edge (not write time)
}

// The Queue producer binding is injected by Cloudflare at runtime.
function getTrackQueue(): { send: (msg: unknown) => Promise<void>; sendBatch?: (msgs: { body: unknown }[]) => Promise<void> } | null {
  try {
    return (globalThis as any).TRACK_QUEUE ?? null
  } catch {
    return null
  }
}

// Enqueue one event. Returns true if it was handed to the queue, false if no
// queue is configured (caller should then fall back to a direct write).
// Pass the request's waitUntil so the send doesn't block the response.
export async function enqueueEvent(
  event: TrackEvent,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<boolean> {
  const q = getTrackQueue()
  if (!q) return false
  const p = q.send(event).catch((e) => {
    // Non-blocking send: a queue error must not break the pixel response.
    console.error('TRACK_QUEUE send failed', e)
  })
  if (waitUntil) waitUntil(p)
  else await p
  return true
}

// ─── Visitor-known gate (KV-cached) ───────────────────────────────────────────
// Beacon only enqueues for visitors that arrived via a known link (i.e. already
// have a visitor_first_touch row). That gate was a Postgres read on every
// pageview (~450M/month). Since a first-touch row never disappears once created,
// we cache the positive result in KV with a long TTL. Negative results are NOT
// cached (a visitor can become known at any moment via a click).
function getKV(): any | null {
  try { return (globalThis as any).METRICS_CACHE ?? null } catch { return null }
}

export async function isVisitorKnown(
  clientId: string,
  visitorId: string,
  sb: ReturnType<typeof getSupabaseAdmin>,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<boolean> {
  const kv = getKV()
  const key = `vk:${clientId}:${visitorId}`

  if (kv) {
    try {
      const cached = await kv.get(key)
      if (cached === '1') return true
    } catch { /* fall through to DB */ }
  }

  const { data } = await sb
    .from('visitor_first_touch')
    .select('visitor_id')
    .eq('client_id', clientId)
    .eq('visitor_id', visitorId)
    .single()

  const known = !!data
  if (known && kv) {
    // Cache the positive fact for 30 days (matches the visitor cookie lifetime).
    const p = kv.put(key, '1', { expirationTtl: 30 * 24 * 60 * 60 }).catch(() => {})
    if (waitUntil) waitUntil(p)
  }
  return known
}

// Mirrors what recordTouchpoint + the purchase insert used to do inline, used
// only when no queue is configured. Kept here so beacon stays small and both
// paths share one implementation.
export async function writeEventDirect(event: TrackEvent): Promise<void> {
  const { recordTouchpoint, markVisitorConverted } = await import('./visitor')
  const sb = getSupabaseAdmin()

  await recordTouchpoint({
    clientId: event.clientId,
    visitorId: event.visitorId,
    channel: event.channel,
    eventType: event.kind === 'purchase' ? 'purchase' : 'return_visit',
    entrySource: event.entrySource,
    isReturnVisit: true,
  })

  if (event.kind === 'purchase') {
    await markVisitorConverted(event.clientId, event.visitorId)
    await sb.from('events').insert({
      client_id: event.clientId,
      type: 'cookie_sale',
      visitor_id: event.visitorId,
      is_return_visit: true,
      entry_source: event.entrySource,
      timestamp: event.ts,
    })
  }
}
