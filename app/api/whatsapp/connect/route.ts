// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/whatsapp/connect/route.ts                              │
// │                                                                            │
// │ ⚠️  This route MUST NOT be listed in PUBLIC_PATHS in middleware.ts.        │
// │ It was, which meant middleware stripped x-user-id and never re-set it —    │
// │ so every config was written with a null client_id (nobody could connect    │
// │ WhatsApp at all) AND anyone on the internet could POST/DELETE here.        │
// │ The guards below are belt-and-braces in case that regresses.               │
// │                                                                            │
// │ waba_id is REQUIRED: message templates live on the WhatsApp Business       │
// │ Account node (/{waba_id}/message_templates), not the phone-number node.    │
// │ Without it, template sync can't run and no template ever reaches APPROVED  │
// │ locally — which silently disables campaigns and cart abandonment.          │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyPhoneNumber, syncTemplatesFromMeta } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

function requireUser(request: NextRequest): string | null {
  const id = request.headers.get('x-user-id')
  return id && id.trim() ? id : null
}

export async function GET(request: NextRequest) {
  const userId = requireUser(request)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('whatsapp_configs')
    .select('phone_number_id, waba_id, phone_display, verified, monthly_conversations_used')
    .eq('client_id', userId)
    .maybeSingle()
  return NextResponse.json(data || { connected: false })
}

export async function POST(request: NextRequest) {
  const userId = requireUser(request)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { phone_number_id, access_token, waba_id } = await request.json()

  if (!phone_number_id || !access_token) {
    return NextResponse.json({ error: 'phone_number_id and access_token required' }, { status: 400 })
  }
  if (!waba_id) {
    return NextResponse.json({
      error: 'WABA ID is required. Templates are managed on the WhatsApp Business Account — find it in Meta dashboard → WhatsApp → API Setup → WhatsApp Business Account ID.'
    }, { status: 400 })
  }

  // Verify with Meta
  const verify = await verifyPhoneNumber({ phone_number_id, access_token })
  if (!verify.ok) {
    return NextResponse.json({ error: 'Invalid credentials — could not reach Meta API. Check your Phone Number ID and token.' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { error } = await sb.from('whatsapp_configs').upsert({
    client_id: userId,
    phone_number_id,
    access_token,
    waba_id,
    phone_display: verify.display,
    verified: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' })
  // Supabase returns errors in `error`, it does NOT throw — the old code
  // reported success regardless of whether the row was actually written.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-sync templates. A failure here is worth surfacing: without APPROVED
  // templates nothing can send, so a silent catch just hid the real problem.
  let templateCount = 0
  let templateWarning: string | null = null
  try {
    templateCount = await syncTemplatesFromMeta(userId, { phone_number_id, access_token, waba_id })
  } catch (e: any) {
    templateWarning = e?.message || 'Template sync failed — retry from the Templates tab.'
  }

  return NextResponse.json({ ok: true, display: verify.display, templateCount, templateWarning })
}

export async function DELETE(request: NextRequest) {
  const userId = requireUser(request)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = getSupabaseAdmin()
  const { error } = await sb.from('whatsapp_configs').delete().eq('client_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
