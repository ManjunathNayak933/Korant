export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

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

// Delivery / read status updates (POST)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: true })

  const sb = getSupabaseAdmin()
  const changes = body.entry?.[0]?.changes || []

  for (const change of changes) {
    const value = change.value || {}
    const statuses = value.statuses || []

    for (const status of statuses) {
      const waId = status.id
      const statusType: string = status.status // sent, delivered, read, failed
      const timestamp = status.timestamp ? new Date(parseInt(status.timestamp) * 1000).toISOString() : new Date().toISOString()
      const errorMessage = status.errors?.[0]?.message || null

      const updates: Record<string, any> = { status: statusType }
      if (statusType === 'delivered') updates.delivered_at = timestamp
      if (statusType === 'read') updates.read_at = timestamp
      if (statusType === 'failed') updates.error_message = errorMessage

      try {
        await sb.from('whatsapp_messages').update(updates).eq('wa_message_id', waId)

        // Roll up to campaign totals
        const { data: msg } = await sb.from('whatsapp_messages').select('campaign_id').eq('wa_message_id', waId).single()
        if (msg?.campaign_id) {
          // Count current totals
          const [{ count: delivered }, { count: read }] = await Promise.all([
            sb.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', msg.campaign_id).in('status', ['delivered', 'read']),
            sb.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', msg.campaign_id).eq('status', 'read'),
          ])
          await sb.from('whatsapp_campaigns').update({ delivered: delivered || 0, read: read || 0, updated_at: new Date().toISOString() }).eq('id', msg.campaign_id)
        }
      } catch {}
    }
  }

  return NextResponse.json({ ok: true })
}
