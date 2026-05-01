export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { attributeSale } from '@/lib/attribution'

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const body = await request.text()
  const sb = getSupabaseAdmin()

  const { data: client } = await sb.from('clients').select('webhook_secret').eq('id', clientId).single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Verify signature
  const webhookSecret = request.headers.get('x-webhook-secret')
  if (client.webhook_secret && webhookSecret !== client.webhook_secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  let payload: any
  try { payload = JSON.parse(body) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.event !== 'payment.captured') {
    return NextResponse.json({ received: true, skipped: true })
  }

  const payment = payload.payload?.payment?.entity || {}
  const notes = payment.notes || {}

  const result = await attributeSale({
    clientId,
    orderValue: (payment.amount || 0) / 100, // Razorpay amounts are in paise
    orderId: payment.id,
    discountCode: notes.discount_code || undefined,
    mkSlug: notes.mk_slug || undefined,
    mkSlugFirst: notes.mk_slug_first || undefined,
    platform: 'razorpay',
  })

  return NextResponse.json({ received: true, attributed: result.attributed })
}
