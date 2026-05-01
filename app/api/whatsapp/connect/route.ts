export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyPhoneNumber, syncTemplatesFromMeta } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('whatsapp_configs')
    .select('phone_number_id, waba_id, phone_display, verified, monthly_conversations_used')
    .eq('client_id', userId)
    .single()
  return NextResponse.json(data || { connected: false })
}

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const { phone_number_id, access_token, waba_id } = await request.json()

  if (!phone_number_id || !access_token) {
    return NextResponse.json({ error: 'phone_number_id and access_token required' }, { status: 400 })
  }

  // Verify with Meta
  const verify = await verifyPhoneNumber({ phone_number_id, access_token })
  if (!verify.ok) {
    return NextResponse.json({ error: 'Invalid credentials — could not reach Meta API. Check your Phone Number ID and token.' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  await sb.from('whatsapp_configs').upsert({
    client_id: userId,
    phone_number_id,
    access_token,
    waba_id: waba_id || null,
    phone_display: verify.display,
    verified: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' })

  // Auto-sync templates
  let templateCount = 0
  try {
    templateCount = await syncTemplatesFromMeta(userId, { phone_number_id, access_token })
  } catch {}

  return NextResponse.json({ ok: true, display: verify.display, templateCount })
}

export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()
  await sb.from('whatsapp_configs').delete().eq('client_id', userId)
  return NextResponse.json({ ok: true })
}
