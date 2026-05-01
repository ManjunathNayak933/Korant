import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getWAConfig, sendTemplateMessage } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()

  // Get campaign
  const { data: campaign, error: campErr } = await sb
    .from('whatsapp_campaigns')
    .select('*')
    .eq('id', (await params).id)
    .eq('client_id', userId)
    .single()

  if (campErr || !campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status === 'sent') return NextResponse.json({ error: 'Already sent' }, { status: 409 })

  // Get WA config
  const config = await getWAConfig(userId)
  if (!config) return NextResponse.json({ error: 'WhatsApp not connected. Go to WhatsApp → Settings.' }, { status: 400 })

  // Get template
  const { data: template } = await sb
    .from('whatsapp_templates')
    .select('*')
    .eq('client_id', userId)
    .eq('template_name', campaign.template_name)
    .single()

  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  if (template.status !== 'APPROVED') {
    return NextResponse.json({ error: `Template status is "${template.status}". Only APPROVED templates can be sent.` }, { status: 400 })
  }

  // Mark as sending
  await sb.from('whatsapp_campaigns').update({ status: 'sending', sent_at: new Date().toISOString() }).eq('id', (await params).id)

  // Get contacts
  const { data: contacts } = await sb
    .from('whatsapp_contacts')
    .select('phone, name, custom_vars')
    .eq('client_id', userId)
    .eq('list_name', campaign.list_name)
    .eq('opted_in', true)

  if (!contacts?.length) {
    await sb.from('whatsapp_campaigns').update({ status: 'draft' }).eq('id', (await params).id)
    return NextResponse.json({ error: 'No opted-in contacts in this list' }, { status: 400 })
  }

  const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${campaign.tracking_slug}`
  const varMap = campaign.variable_map || {}
  let sent = 0, errors = 0

  // Send in batches of 50 — Meta allows ~80 req/sec
  const BATCH = 50
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH)
    await Promise.all(batch.map(async (contact) => {
      // Build variables — replace {{name}}, {{link}}, and numbered {{1}}, {{2}}
      const variables: string[] = []
      for (let v = 1; v <= (template.variable_count || 0); v++) {
        const key = varMap[`{{${v}}}`] || varMap[String(v)]
        if (key === '__name__') variables.push(contact.name || 'there')
        else if (key === '__link__') variables.push(trackingLink)
        else if (key === '__custom__') variables.push(contact.custom_vars?.[`var${v}`] || '')
        else variables.push(key || '')
      }

      const result = await sendTemplateMessage(config, {
        to: contact.phone,
        templateName: campaign.template_name,
        language: template.language || 'en',
        variables,
        trackingUrl: trackingLink,
      })

      if ('error' in result) {
        errors++
        await sb.from('whatsapp_messages').insert({
          campaign_id: (await params).id,
          client_id: userId,
          phone: contact.phone,
          contact_name: contact.name,
          status: 'failed',
          error_message: result.error,
        })
      } else {
        sent++
        await sb.from('whatsapp_messages').insert({
          campaign_id: (await params).id,
          client_id: userId,
          wa_message_id: result.wa_message_id,
          phone: contact.phone,
          contact_name: contact.name,
          status: 'sent',
        })
      }
    }))

    // Update progress every batch
    await sb.from('whatsapp_campaigns').update({ sent, status: 'sending' }).eq('id', (await params).id)

    // Small delay between batches to avoid rate limits
    if (i + BATCH < contacts.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  await sb.from('whatsapp_campaigns').update({
    status: 'sent',
    sent,
    total_contacts: contacts.length,
    updated_at: new Date().toISOString(),
  }).eq('id', (await params).id)

  return NextResponse.json({ ok: true, sent, errors, total: contacts.length })
}
