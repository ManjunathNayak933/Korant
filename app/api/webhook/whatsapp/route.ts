// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/webhook/whatsapp/route.ts                              │
// │                                                                            │
// │ BUG FIX: this only ever updated `whatsapp_messages` (campaign sends).      │
// │ Cart-abandonment sends are logged to `cart_messages` with the same         │
// │ wa_message_id, and nothing read it back — so a cart message stayed 'sent'  │
// │ forever even when Meta reported it as failed, and the per-step "sent"      │
// │ figure in the Cart Abandonment tab counted messages that never arrived.    │
// │ Both tables are now updated from the same status event.                    │
// │                                                                            │
// │ Campaign roll-ups are also no longer recomputed on EVERY status callback   │
// │ (that was 3 extra queries per event — ~30k on a 10k-contact campaign);     │
// │ they run on terminal statuses only.                                        │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Status ordering so an out-of-order webhook can't move a message backwards.
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 }

// Meta webhook verification (GET)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'korant-wa-verify'
  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Verifies Meta's X-Hub-Signature-256 header: 'sha256=' + HMAC-SHA256(rawBody, APP_SECRET).
async function verifyMetaSignature(rawBody: string, header: string, appSecret: string): Promise<boolean> {
  const expectedPrefix = 'sha256='
  if (!header.startsWith(expectedPrefix)) return false
  const sigHex = header.slice(expectedPrefix.length)
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  // constant-time-ish compare
  if (computed.length !== sigHex.length) return false
  let ok = true
  for (let i = 0; i < computed.length; i++) if (computed[i] !== sigHex[i]) ok = false
  return ok
}

// Delivery / read status updates (POST)
export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Verify the payload is really from Meta. FAIL CLOSED: if no app secret is
  // configured we cannot authenticate the request, so we reject it. Set
  // WHATSAPP_APP_SECRET (the Meta App Secret) to enable status webhooks.
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || ''
  if (!appSecret) {
    console.error('[whatsapp webhook] rejected: WHATSAPP_APP_SECRET / META_APP_SECRET not configured')
    return new NextResponse('Webhook secret not configured', { status: 401 })
  }
  const sigHeader = request.headers.get('x-hub-signature-256') || ''
  const valid = await verifyMetaSignature(rawBody, sigHeader, appSecret)
  if (!valid) return new NextResponse('Invalid signature', { status: 401 })

  let body: any = null
  try { body = JSON.parse(rawBody) } catch { /* ignore */ }
  if (!body) return NextResponse.json({ ok: true })

  const sb = getSupabaseAdmin()
  const changes = body.entry?.[0]?.changes || []

  // Campaigns whose totals need one roll-up at the end of this batch.
  const campaignsToRollUp = new Set<string>()

  for (const change of changes) {
    const value = change.value || {}
    const statuses = value.statuses || []

    for (const status of statuses) {
      const waId = status.id
      const statusType: string = status.status // sent, delivered, read, failed
      const timestamp = status.timestamp ? new Date(parseInt(status.timestamp) * 1000).toISOString() : new Date().toISOString()
      const errorMessage = status.errors?.[0]?.message || null

      // Shared: build the field patch for whichever table holds this message.
      const buildPatch = (cur: string | undefined) => {
        const updates: Record<string, any> = {}
        if (statusType === 'delivered') updates.delivered_at = timestamp
        if (statusType === 'read') updates.read_at = timestamp
        if (statusType === 'failed') updates.error_message = errorMessage

        // Only move `status` FORWARD. WhatsApp status webhooks can arrive out of
        // order (e.g. a late 'delivered' after 'read'); setting status
        // unconditionally would regress 'read' back to 'delivered'. 'failed'
        // only applies before success (sent → failed), never over read/delivered.
        if (statusType === 'failed') {
          if (!cur || cur === 'sent') updates.status = 'failed'
        } else if (!cur || (STATUS_RANK[statusType] || 0) > (STATUS_RANK[cur] || 0)) {
          updates.status = statusType
        }
        return updates
      }

      try {
        // ── Campaign messages ────────────────────────────────────────────
        const { data: msg } = await sb.from('whatsapp_messages')
          .select('campaign_id, status').eq('wa_message_id', waId).maybeSingle()

        if (msg) {
          const updates = buildPatch(msg.status)
          if (Object.keys(updates).length > 0) {
            await sb.from('whatsapp_messages').update(updates).eq('wa_message_id', waId)
          }
          // Roll up once per batch on terminal statuses only.
          if (msg.campaign_id && (statusType === 'delivered' || statusType === 'read')) {
            campaignsToRollUp.add(msg.campaign_id)
          }
          continue
        }

        // ── Cart-abandonment messages ────────────────────────────────────
        const { data: cartMsg } = await sb.from('cart_messages')
          .select('id, cart_id, status').eq('wa_message_id', waId).maybeSingle()

        if (cartMsg) {
          const updates = buildPatch(cartMsg.status)
          if (Object.keys(updates).length > 0) {
            // `delivered_at` / `read_at` may not exist on older cart_messages
            // schemas — retry with just `status` + `error_message` so the
            // status still lands instead of the whole update erroring out.
            const { error } = await sb.from('cart_messages').update(updates).eq('id', cartMsg.id)
            if (error) {
              const minimal: Record<string, any> = {}
              if (updates.status) minimal.status = updates.status
              if (updates.error_message) minimal.error_message = updates.error_message
              if (Object.keys(minimal).length) {
                await sb.from('cart_messages').update(minimal).eq('id', cartMsg.id)
              }
            }
          }
        }
      } catch (e) {
        console.error('[whatsapp webhook] status update failed', { waId, e: String(e) })
      }
    }
  }

  // One roll-up per campaign per batch, not per status event.
  for (const campaignId of campaignsToRollUp) {
    try {
      const [{ count: delivered }, { count: read }] = await Promise.all([
        sb.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['delivered', 'read']),
        sb.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'read'),
      ])
      await sb.from('whatsapp_campaigns').update({
        delivered: delivered || 0, read: read || 0, updated_at: new Date().toISOString(),
      }).eq('id', campaignId)
    } catch { /* roll-up is cosmetic; never fail the webhook */ }
  }

  return NextResponse.json({ ok: true })
}
