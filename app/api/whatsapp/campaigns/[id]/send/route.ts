// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/campaigns/[id]/send/route.ts              │
// │ Replace the existing file at <repo-root>/app/api/whatsapp/campaigns/[id]/send/route.ts │
// └──────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getWAConfig, sendTemplateMessage } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()
  const { id } = await params

  // Get campaign — must belong to this user
  const { data: campaign, error: campErr } = await sb
    .from('whatsapp_campaigns')
    .select('*')
    .eq('id', id)
    .eq('client_id', userId)
    .single()

  if (campErr || !campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status === 'sent') return NextResponse.json({ error: 'Already sent' }, { status: 409 })
  if (campaign.status === 'sending') return NextResponse.json({ error: 'Send already in progress' }, { status: 409 })

  const config = await getWAConfig(userId)
  if (!config) return NextResponse.json({ error: 'WhatsApp not connected. Go to WhatsApp → Settings.' }, { status: 400 })

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

  const { data: contacts } = await sb
    .from('whatsapp_contacts')
    .select('phone, name, custom_vars')
    .eq('client_id', userId)
    .eq('list_name', campaign.list_name)
    .eq('opted_in', true)

  if (!contacts?.length) {
    return NextResponse.json({ error: 'No opted-in contacts in this list' }, { status: 400 })
  }

  // BUG FIX (duplicate-send race): the status checks above are a fast pre-filter,
  // but check-then-set is not atomic — two near-simultaneous requests could both
  // read a non-sending status and both fire to every contact (double the messages
  // to customers AND double the cost). Claim the send with a CONDITIONAL update
  // that only succeeds if the status is still what we just read; if another request
  // already flipped it to 'sending', this matches 0 rows and we bail.
  const priorStatus = campaign.status
  const { data: claimed } = await sb
    .from('whatsapp_campaigns')
    .update({ status: 'sending', sent_at: new Date().toISOString(), total_contacts: contacts.length })
    .eq('id', id)
    .eq('status', priorStatus)
    .select('id')
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'Send already in progress or completed' }, { status: 409 })
  }

  // Use waitUntil so the worker keeps running after the response is sent.
  // The browser gets an immediate "started" response; frontend polls /stats for progress.
  const ctx = (request as any)[Symbol.for('cloudflare-request-context')]
  const sendInBackground = async () => {
    const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${campaign.tracking_slug}`
    const varMap = campaign.variable_map || {}
    let sent = 0, errors = 0
    const BATCH = 50

    for (let i = 0; i < contacts.length; i += BATCH) {
      const batch = contacts.slice(i, i + BATCH)
      await Promise.all(batch.map(async (contact: any) => {
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
          // BUG FIX: the URL-button template is built as `base/{{1}}`, so the {{1}}
          // value must be just the SLUG. Passing the full trackingLink here produced
          // a doubled URL (`…/r/https://…/r/wa-xxx`). The body `__link__` variable
          // still uses the full trackingLink (a full URL in message text is correct).
          trackingUrl: campaign.tracking_slug,
        })

        if ('error' in result) {
          errors++
          await sb.from('whatsapp_messages').insert({
            campaign_id: id, client_id: userId,
            phone: contact.phone, contact_name: contact.name,
            status: 'failed', error_message: result.error,
          })
        } else {
          sent++
          await sb.from('whatsapp_messages').insert({
            campaign_id: id, client_id: userId,
            wa_message_id: result.wa_message_id,
            phone: contact.phone, contact_name: contact.name,
            status: 'sent',
          })
        }
      }))

      // Update progress after every batch so the UI can poll it
      await sb.from('whatsapp_campaigns').update({ sent, updated_at: new Date().toISOString() }).eq('id', id)

      // Small delay between batches — Meta allows ~80 req/sec
      if (i + BATCH < contacts.length) {
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // Final status
    await sb.from('whatsapp_campaigns').update({
      status: 'sent', sent, updated_at: new Date().toISOString(),
    }).eq('id', id)
  }

  // If running on Cloudflare Workers, use waitUntil for non-blocking background execution
  if (ctx?.waitUntil) {
    ctx.waitUntil(sendInBackground())
  } else {
    // Local dev fallback — runs synchronously (Next.js dev server)
    sendInBackground().catch(console.error)
  }

  return NextResponse.json({
    ok: true,
    started: true,
    total: contacts.length,
    message: `Sending to ${contacts.length} contacts in background. Check the campaign for progress.`,
  })
}
