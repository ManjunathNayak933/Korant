// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/whatsapp.ts                                            │
// │                                                                        │
// │ WhatsApp Business Cloud API (Meta Graph API).                          │
// │                                                                        │
// │ ── Fixes in this revision ──────────────────────────────────────────── │
// │ B2  syncTemplatesFromMeta() upserted with                              │
// │     onConflict: 'client_id,template_name,language'. That unique index  │
// │     does not exist in the live schema, so Postgres raised 42P10 on     │
// │     EVERY row — and the result was never inspected, so the function    │
// │     reported "synced N" while writing nothing. No template ever        │
// │     reached APPROVED locally, so the cart tick held every message      │
// │     forever and the Cart Abandonment template dropdown stayed empty.   │
// │     The write is now checked, falls back to select→update→insert when  │
// │     the index is missing, and throws with an actionable message if a   │
// │     row genuinely fails.                                                │
// │ B3  buildTemplateComponents() is exported so the create-template route │
// │     can persist the SAME `button_config` it submits to Meta. Without   │
// │     it, findDynamicUrlButtonIndex() returned -1 for every locally      │
// │     created template and the tick held the send with "no link route".  │
// │ M5  sendTemplateMessage() returned { wa_message_id: '' } when Meta's   │
// │     response didn't carry a message id. That counted as a success,     │
// │     wrote an empty string into a UNIQUE column (so the second one      │
// │     silently failed with 23505), and left a message that could never   │
// │     receive a delivery/read callback. A missing id is now an error.    │
// └──────────────────────────────────────────────────────────────────────┘
import { getSupabaseAdmin } from './supabase'

// Graph API versions stay supported ~2 years; override per-deploy if needed.
const META_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0'
const META_BASE = `https://graph.facebook.com/${META_VERSION}`

export interface WAConfig {
  phone_number_id: string
  access_token: string
  waba_id?: string
}

export async function getWAConfig(clientId: string): Promise<WAConfig | null> {
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('whatsapp_configs')
    .select('phone_number_id, access_token, waba_id, verified')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!data?.verified) return null
  return data
}

// ── Templates ──────────────────────────────────────────────────────────────

// Persist one template row without depending on a unique index existing.
// Returns 'saved' | 'failed'. `useUpsert` is a caller-held flag so we only pay
// for the 42P10 discovery once per sync instead of once per template.
async function saveTemplateRow(
  row: Record<string, any>,
  state: { useUpsert: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseAdmin()

  if (state.useUpsert) {
    const { error } = await sb.from('whatsapp_templates')
      .upsert(row, { onConflict: 'client_id,template_name,language' })
    if (!error) return { ok: true }
    // 42P10 = "there is no unique or exclusion constraint matching the ON
    // CONFLICT specification". The index is missing on this database; stop
    // trying to use it and take the explicit path for the rest of the sync.
    if ((error as any).code !== '42P10') return { ok: false, error: error.message }
    state.useUpsert = false
    console.warn(
      '[whatsapp] whatsapp_templates has no unique index on (client_id, template_name, language) — ' +
      'falling back to select/update. Run database/migrations/2026-07-cart-abandonment-fixes.sql.'
    )
  }

  const { data: existing } = await sb.from('whatsapp_templates')
    .select('id')
    .eq('client_id', row.client_id)
    .eq('template_name', row.template_name)
    .eq('language', row.language)
    .limit(1)

  if (existing?.[0]) {
    const { error } = await sb.from('whatsapp_templates').update(row).eq('id', existing[0].id)
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  const { error } = await sb.from('whatsapp_templates').insert(row)
  // A concurrent sync inserted the same template first — that's fine.
  if (error && (error as any).code === '23505') return { ok: true }
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Message templates are a WhatsApp Business Account (WABA) resource:
//   GET /{waba_id}/message_templates
// Paginates via `paging.next` (capped defensively at 5 pages / 500 templates).
// Returns the number of rows ACTUALLY WRITTEN — not the number fetched from
// Meta, which is what made the previous silent failure look like a success.
export async function syncTemplatesFromMeta(clientId: string, config: WAConfig): Promise<number> {
  const wabaId = config.waba_id
  if (!wabaId) {
    throw new Error(
      'WABA ID missing. Templates are managed on the WhatsApp Business Account — ' +
      'add your WABA ID in WhatsApp → Settings (Meta dashboard → WhatsApp → API Setup), then sync again.'
    )
  }

  let url: string | null =
    `${META_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,status,category,language,components`
  let saved = 0
  const failures: string[] = []
  const state = { useUpsert: true }

  for (let page = 0; page < 5 && url; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.access_token}` } })
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(`Meta templates fetch failed: ${res.status} ${json?.error?.message || ''}`.trim())
    }
    const templates = json.data || []

    for (const t of templates) {
      const bodyComp = t.components?.find((c: any) => c.type === 'BODY')
      const headerComp = t.components?.find((c: any) => c.type === 'HEADER')
      const footerComp = t.components?.find((c: any) => c.type === 'FOOTER')
      const buttonComp = t.components?.find((c: any) => c.type === 'BUTTONS')
      const bodyText = bodyComp?.text || ''
      const varCount = (bodyText.match(/\{\{[0-9]+\}\}/g) || []).length

      const result = await saveTemplateRow({
        client_id: clientId,
        template_name: t.name,
        category: t.category,
        language: t.language,
        status: t.status,
        header_text: headerComp?.text || null,
        header_type: headerComp?.format || null,
        header_media_url: headerComp?.example?.header_handle?.[0] || null,
        body_text: bodyText,
        footer_text: footerComp?.text || null,
        has_buttons: !!buttonComp,
        button_config: buttonComp || null,
        variable_count: varCount,
        meta_template_id: t.id,
        updated_at: new Date().toISOString(),
      }, state)

      if (result.ok) saved++
      else failures.push(`${t.name} (${t.language}): ${result.error}`)
    }
    url = json.paging?.next || null
  }

  if (failures.length) {
    throw new Error(
      `Synced ${saved} template(s), but ${failures.length} could not be saved: ${failures.slice(0, 3).join('; ')}` +
      (failures.length > 3 ? ' …' : '')
    )
  }
  return saved
}


// ── Media upload ────────────────────────────────────────────────────────────

export async function uploadMediaToMeta(
  config: WAConfig,
  fileBase64: string,
  mimeType: string,
  fileName: string
): Promise<{ media_id: string } | { error: string }> {
  // Convert base64 to blob via fetch data URL
  const dataUrl = `data:${mimeType};base64,${fileBase64}`
  const blobRes = await fetch(dataUrl)
  const blob = await blobRes.blob()

  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)

  const res = await fetch(`${META_BASE}/${config.phone_number_id}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.access_token}` },
    body: form,
  })
  const json = await res.json()
  if (!res.ok) return { error: json.error?.message || 'Media upload failed' }
  return { media_id: json.id }
}

export interface TemplateDraft {
  name: string; category: string; language: string
  bodyText: string; headerText?: string; footerText?: string
  buttonText?: string; buttonUrl?: string; trackingUrl?: string; trackingBase?: string; exampleSlug?: string
  headerType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  headerMediaId?: string
}

// Build the exact `components` array we submit to Meta. Exported (B3) so the
// create-template route can store the BUTTONS component it just submitted:
// `whatsapp_templates.button_config` is what findDynamicUrlButtonIndex() reads
// at send time, and a locally created template used to have it null forever —
// which made the cart tick hold every message with "no link route on template".
export function buildTemplateComponents(template: TemplateDraft): any[] {
  const components: any[] = []
  if (template.headerType && template.headerType !== 'TEXT' && template.headerMediaId) {
    components.push({
      type: 'HEADER',
      format: template.headerType,
      example: { header_handle: [template.headerMediaId] },
    })
  } else if (template.headerText) {
    components.push({ type: 'HEADER', format: 'TEXT', text: template.headerText })
  }
  components.push({ type: 'BODY', text: template.bodyText })
  if (template.footerText) {
    components.push({ type: 'FOOTER', text: template.footerText })
  }
  if (template.buttonUrl) {
    // Always use {{1}} as the dynamic URL variable — tracking slug injected at send time
    // Meta requires the base domain to be fixed; we use the tracking endpoint as base
    const baseTrackingUrl = template.trackingBase || template.buttonUrl
    const dynamicUrl = baseTrackingUrl.includes('{{1}}') ? baseTrackingUrl : `${baseTrackingUrl}/{{1}}`
    components.push({
      type: 'BUTTONS',
      buttons: [{
        type: 'URL',
        text: template.buttonText || 'Shop Now',
        url: dynamicUrl,
        example: [template.exampleSlug || 'example-campaign'],
      }],
    })
  }
  return components
}

/** The BUTTONS component of a draft, or null — this is what goes in button_config. */
export function buttonConfigFor(template: TemplateDraft): any | null {
  return buildTemplateComponents(template).find(c => c.type === 'BUTTONS') || null
}

export async function submitTemplate(config: WAConfig, wabaId: string, template: TemplateDraft) {
  const components = buildTemplateComponents(template)

  const res = await fetch(`${META_BASE}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: template.name.toLowerCase().replace(/\s+/g, '_'),
      category: template.category,
      language: template.language,
      components,
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message || 'Template submission failed')
  return json
}

// ── Sending ────────────────────────────────────────────────────────────────

// Meta's BUTTONS component holds a mixed list: QUICK_REPLY, PHONE_NUMBER,
// URL (static) and URL (dynamic). Only the DYNAMIC one — whose url ends in a
// {{1}} placeholder — accepts a parameter at send time. Passing a parameter to
// any of the others gets the whole message rejected (132000 / 131009).
//
// `whatsapp_templates.has_buttons` is true for all four, so it must NOT be used
// to decide this. Returns the button's index within the component (Meta needs
// the real position, not a hardcoded 0), or -1 when there isn't one.
export function findDynamicUrlButtonIndex(buttonConfig: any): number {
  const buttons = buttonConfig?.buttons
  if (!Array.isArray(buttons)) return -1
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i] || {}
    if (String(b.type || '').toUpperCase() !== 'URL') continue
    if (String(b.url || '').includes('{{')) return i
  }
  return -1
}

export interface SendMessageParams {
  to: string // phone number with country code, no +
  templateName: string
  language: string
  variables: string[] // positional: {{1}}, {{2}}, ...
  trackingUrl?: string
  // Index of the template's DYNAMIC url button (see findDynamicUrlButtonIndex).
  // -1 / omitted → no button component is attached and the link is expected to
  // travel in the body instead. The old `hasButtons` boolean is kept for
  // existing callers but only means "index 0" — prefer urlButtonIndex.
  urlButtonIndex?: number
  /** @deprecated use urlButtonIndex */
  hasButtons?: boolean
}

export async function sendTemplateMessage(
  config: WAConfig,
  params: SendMessageParams
): Promise<{ wa_message_id: string } | { error: string }> {
  const to = params.to ? params.to.replace(/\D/g, '') : ''
  if (!to) return { error: 'No destination phone number on this contact' }

  const bodyParams = params.variables.map(v => ({ type: 'text', text: v }))

  const components: any[] = []
  if (bodyParams.length > 0) {
    components.push({ type: 'body', parameters: bodyParams })
  }
  // Inject the tracking slug as the button's URL parameter ({{1}} in the
  // template's button url) — ONLY when the template really has a dynamic URL
  // button, and at that button's real index.
  const btnIndex = params.urlButtonIndex ?? (params.hasButtons ? 0 : -1)
  if (params.trackingUrl && btnIndex >= 0) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(btnIndex),
      parameters: [{ type: 'text', text: params.trackingUrl }],
    })
  }

  const body: any = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.language },
      components: components.length > 0 ? components : undefined,
    },
  }

  let res: Response
  try {
    res = await fetch(`${META_BASE}/${config.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    // A network failure must look like a failure to the caller so the step is
    // retried, not marked as delivered.
    return { error: `Network error calling Meta: ${e?.message || String(e)}` }
  }

  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json?.error?.message || `Send failed (${res.status})` }

  // M5: no id back means we have nothing to reconcile delivery/read callbacks
  // against, and `wa_message_id` is UNIQUE — writing '' poisons the column for
  // every later message. Treat it as a failure and let the step retry.
  const waId = json?.messages?.[0]?.id
  if (!waId) return { error: 'Meta accepted the request but returned no message id' }
  return { wa_message_id: String(waId) }
}

// ── Estimate cost ──────────────────────────────────────────────────────────
// Meta bills marketing PER DELIVERED TEMPLATE MESSAGE (since July 2025).
// Keep MARKETING_RATE_INR aligned with Meta's current rate card before relying
// on this for client-facing quotes.
export function estimateCost(
  contactCount: number
): { inr: number; messages: number; conversations: number } {
  const MARKETING_RATE_INR = 0.78 // approx India marketing per-message rate; verify vs current Meta rate card
  const messages = contactCount   // one template message per contact
  return {
    inr: Math.round(messages * MARKETING_RATE_INR * 100) / 100,
    messages,
    conversations: contactCount, // kept for backward compatibility with existing callers
  }
}

// ── Phone number verification ──────────────────────────────────────────────

export async function verifyPhoneNumber(config: WAConfig): Promise<{ ok: boolean; display?: string }> {
  const res = await fetch(`${META_BASE}/${config.phone_number_id}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${config.access_token}` },
  })
  if (!res.ok) return { ok: false }
  const json = await res.json()
  return { ok: true, display: `${json.verified_name} (${json.display_phone_number})` }
}
