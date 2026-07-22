// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/webhookAuth.ts                                             │
// │                                                                            │
// │ ONE auth path for the client-secret webhooks (cart intake + generic order  │
// │ intake). Fixes QC B8: the two endpoints used to disagree on where the      │
// │ secret goes — the order endpoint wanted an `x-webhook-secret` HEADER, the  │
// │ cart endpoint wanted `?k=` in the URL — which was a constant 401 trap.     │
// │                                                                            │
// │ Now BOTH accept the secret EITHER way:                                     │
// │   • header  `x-webhook-secret: <secret>`                                   │
// │   • query   `?k=<secret>`  (also `?secret=`)                               │
// │ and the client id under EITHER name: `?clientId=` or `?cid=`.              │
// │                                                                            │
// │ Why keep the URL option at all: some senders can't add a custom header —   │
// │ e.g. WooCommerce's built-in webhooks — so the URL form is the only way     │
// │ they can authenticate. The header form is preferred where available        │
// │ (URLs leak into logs/history more than headers do).                        │
// └──────────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'

export interface WebhookAuthResult {
  ok: boolean
  clientId?: string
  status?: number
  error?: string
}

// Length-independent constant-time-ish compare, so a wrong secret can't be
// narrowed down by response timing.
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export async function authenticateWebhook(request: Request): Promise<WebhookAuthResult> {
  const q = new URL(request.url).searchParams

  // Client id under either param name.
  const clientId = (q.get('clientId') || q.get('cid') || '').trim()
  if (!clientId) {
    return { ok: false, status: 401, error: 'clientId (or cid) is required in the URL' }
  }

  // Secret from the header first, then the URL.
  const provided =
    request.headers.get('x-webhook-secret') ||
    q.get('k') ||
    q.get('secret') ||
    ''
  if (!provided) {
    return {
      ok: false, status: 401,
      error: 'Missing webhook secret. Send it as the x-webhook-secret header, or as ?k=<secret> in the URL.',
    }
  }

  const sb = getSupabaseAdmin()
  const { data: client } = await sb
    .from('clients').select('id, webhook_secret').eq('id', clientId).maybeSingle()
  if (!client || !client.webhook_secret) {
    return { ok: false, status: 401, error: 'Invalid client, or webhook secret not configured' }
  }
  if (!secretsMatch(provided, client.webhook_secret)) {
    return { ok: false, status: 401, error: 'Invalid webhook secret' }
  }

  return { ok: true, clientId: client.id }
}

// Grab the first present, non-empty value across a list of possible field names.
// Lets the intake tolerate the naming a given platform happens to use without a
// bespoke adapter per platform.
export function pickField(body: any, keys: string[]): any {
  if (!body || typeof body !== 'object') return undefined
  for (const k of keys) {
    const v = body[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}
