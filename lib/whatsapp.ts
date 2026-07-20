// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/whatsapp.ts                                            │
// │                                                                        │
// │ WhatsApp Business Cloud API (Meta Graph API). Two fixes worth noting: │
// │  1. Templates live on the WABA node (`/{waba_id}/message_templates`), │
// │     NOT the phone-number node — the old sync always 400'd, so no      │
// │     template ever reached APPROVED locally.                            │
// │  2. sendTemplateMessage only attaches a URL-button component when the │
// │     template actually has buttons; Meta rejects the send otherwise.   │
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

// Message templates are a WhatsApp Business Account (WABA) resource:
//   GET /{waba_id}/message_templates
// Paginates via `paging.next` (capped defensively at 5 pages / 500 templates).
export async function syncTemplatesFromMeta(clientId: string, config: WAConfig) {
  const wabaId = config.waba_id
  if (!wabaId) {
    throw new Error(
      'WABA ID missing. Templates are managed on the WhatsApp Business Account — ' +
      'add your WABA ID in WhatsApp → Settings (Meta dashboard → WhatsApp → API Setup), then sync again.'
    )
  }

  const sb = getSupabaseAdmin()
  let url: string | null =
    `${META_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,status,category,language,components`
  let total = 0

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

      await sb.from('whatsapp_templates').upsert({
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
      }, { onConflict: 'client_id,template_name,language' })
    }
    total += templates.length
    url = json.paging?.next || null
  }
  return total
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

export async function submitTemplate(config: WAConfig, wabaId: string, template: {
  name: string; category: string; language: string
  bodyText: string; headerText?: string; footerText?: string
  buttonText?: string; buttonUrl?: string; trackingUrl?: string; trackingBase?: string; exampleSlug?: string
  headerType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  headerMediaId?: string
}) {
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
    to: params.to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.language },
      components: components.length > 0 ? components : undefined,
    },
  }

  const res = await fetch(`${META_BASE}/${config.phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok) return { error: json.error?.message || 'Send failed' }
  return { wa_message_id: json.messages?.[0]?.id || '' }
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
