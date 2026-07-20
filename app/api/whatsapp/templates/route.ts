// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/templates/route.ts                            │
// │                                                                            │
// │ Templates are a WABA resource. Both sync and submit now use config.waba_id │
// │ consistently — sync previously hit the phone-number node, which always     │
// │ failed, so nothing ever reached APPROVED and every send was blocked.       │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getWAConfig, syncTemplatesFromMeta, submitTemplate } from '@/lib/whatsapp'

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
  const { name, category = 'MARKETING', language = 'en', bodyText, headerText, headerType, headerMediaId, footerText, buttonText, buttonUrl } = body

  if (!name || !bodyText) return NextResponse.json({ error: 'name and bodyText required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // Save to DB first
  const varCount = (bodyText.match(/\{\{[0-9]+\}\}/g) || []).length
  const { data: tmpl, error } = await sb
    .from('whatsapp_templates')
    .insert({
      client_id: userId,
      template_name: name.toLowerCase().replace(/\s+/g, '_'),
      category,
      language,
      status: 'PENDING',
      header_text: headerText || null,
      header_type: headerType || 'TEXT',
      header_media_id: headerMediaId || null,
      body_text: bodyText,
      footer_text: footerText || null,
      variable_count: varCount,
      has_buttons: !!buttonUrl,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Submit to Meta if connected. getWAConfig already carries waba_id — no need
  // for the extra whatsapp_configs read the old code did.
  const config = await getWAConfig(userId)
  if (config?.waba_id) {
    try {
      const metaRes = await submitTemplate(config, config.waba_id, {
        name: tmpl.template_name, category, language, bodyText,
        headerText, footerText, buttonText, buttonUrl,
      })
      await sb.from('whatsapp_templates').update({ meta_template_id: metaRes.id, status: 'PENDING' }).eq('id', tmpl.id)
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
