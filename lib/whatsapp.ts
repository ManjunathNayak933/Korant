import { getSupabaseAdmin } from './supabase'

const META_VERSION = 'v25.0'
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
    .single()
  if (!data?.verified) return null
  return data
}

// ── Templates ──────────────────────────────────────────────────────────────

export async function syncTemplatesFromMeta(clientId: string, config: WAConfig) {
  const res = await fetch(
    `${META_BASE}/${config.phone_number_id}/message_templates?limit=50`,
    { headers: { Authorization: `Bearer ${config.access_token}` } }
  )
  if (!res.ok) throw new Error(`Meta templates fetch failed: ${res.status}`)
  const json = await res.json()
  const templates = json.data || []

  const sb = getSupabaseAdmin()
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
  return templates.length
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

export interface SendMessageParams {
  to: string // phone number with country code, no +
  templateName: string
  language: string
  variables: string[] // positional: {{1}}, {{2}}, ...
  trackingUrl?: string
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
  // Inject tracking URL as button URL parameter ({{1}} in template button URL)
  if (params.trackingUrl) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
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
// Meta switched WhatsApp billing in July 2025 from per-24h-conversation to
// PER DELIVERED TEMPLATE MESSAGE. The old "first 1000 conversations free /
// ₹0.69 per conversation" model no longer applies to marketing. We now bill
// per message at the India marketing template rate. The free entry-point /
// service-conversation allowances are separate and not modelled here.
//
// NOTE: the per-message rate changes by country and over time — keep
// MARKETING_RATE_INR aligned with Meta's current rate card before relying on
// this for client-facing quotes.
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
