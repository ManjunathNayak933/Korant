// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/templates/route.ts                            │
// │                                                                            │
// │ Templates are a WABA resource. Both sync and submit use config.waba_id.    │
// │                                                                            │
// │ ── Fixes in this revision ────────────────────────────────────────────────│
// │ B3  The insert wrote `has_buttons` but never `button_config`, so           │
// │     findDynamicUrlButtonIndex() returned -1 for every template created     │
// │     in-app. The cart tick then held every send with "no link route on      │
// │     template" — even after Meta approved it — because it had no way to     │
// │     know which button takes the tracking parameter. We now persist the     │
// │     exact BUTTONS component we submit to Meta.                             │
// │ B2  GET ?sync=1 now reports rows actually WRITTEN and surfaces the real    │
// │     error instead of reporting success on a write that never happened.     │
// │ +   A duplicate (client, name, language) now returns a clean 409 instead   │
// │     of a raw Postgres unique-violation message.                            │
// │                                                                            │
// │ NOTE for cart-recovery templates: `buttonUrl` must be your redirect base,  │
// │ i.e. `https://<your domain>/r` — the sender appends the per-cart slug as   │
// │ the {{1}} parameter, producing https://<domain>/r/<step-slug>.<cart-id>.   │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  getWAConfig, syncTemplatesFromMeta, submitTemplate, buttonConfigFor, type TemplateDraft,
} from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const sync = searchParams.get('sync') === '1'

  if (sync) {
    const config = await getWAConfig(userId)
    if (!config) return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 })
    try {
      const count = await syncTemplatesFromMeta(userId, config)
      return NextResponse.json({ synced: count })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('whatsapp_templates')
    .select('*')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const {
    name, category = 'MARKETING', language = 'en', bodyText,
    headerText, headerType, headerMediaId, footerText,
    buttonText, buttonUrl, trackingBase, exampleSlug,
  } = body

  if (!name || !bodyText) return NextResponse.json({ error: 'name and bodyText required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  const draft: TemplateDraft = {
    name: String(name).toLowerCase().replace(/\s+/g, '_'),
    category, language, bodyText,
    headerText, footerText, headerType, headerMediaId,
    buttonText, buttonUrl, trackingBase, exampleSlug,
  }

  // B3: the same component list that goes to Meta is what the sender needs back
  // at send time to locate the dynamic URL button.
  const buttonConfig = buttonConfigFor(draft)

  // Save to DB first
  const varCount = (bodyText.match(/\{\{[0-9]+\}\}/g) || []).length
  const { data: tmpl, error } = await sb
    .from('whatsapp_templates')
    .insert({
      client_id: userId,
      template_name: draft.name,
      category,
      language,
      status: 'PENDING',
      header_text: headerText || null,
      header_type: headerType || 'TEXT',
      header_media_id: headerMediaId || null,
      body_text: bodyText,
      footer_text: footerText || null,
      variable_count: varCount,
      has_buttons: !!buttonConfig,
      button_config: buttonConfig,
    })
    .select()
    .single()

  if (error) {
    if ((error as any).code === '23505') {
      return NextResponse.json(
        { error: `A template named "${draft.name}" already exists in ${language}. Edit or delete it first.` },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Submit to Meta if connected. getWAConfig already carries waba_id — no need
  // for the extra whatsapp_configs read the old code did.
  const config = await getWAConfig(userId)
  if (config?.waba_id) {
    try {
      const metaRes = await submitTemplate(config, config.waba_id, draft)
      await sb.from('whatsapp_templates')
        .update({ meta_template_id: metaRes.id, status: 'PENDING' })
        .eq('id', tmpl.id)
    } catch (e: any) {
      // Don't fail — template saved locally, Meta submission failed
      return NextResponse.json({ ...tmpl, meta_warning: e.message }, { status: 201 })
    }
  } else if (config) {
    return NextResponse.json({
      ...tmpl,
      meta_warning: 'Saved locally but not submitted to Meta: no WABA ID on your WhatsApp connection. Add it in WhatsApp → Settings.',
    }, { status: 201 })
  }

  return NextResponse.json(tmpl, { status: 201 })
}
