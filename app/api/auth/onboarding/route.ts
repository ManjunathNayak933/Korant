export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// PATCH /api/auth/onboarding
// Saves setup/onboarding state to the user's profile.
// Merges with existing onboarding — never overwrites unset fields.
export async function PATCH(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const sb   = getSupabaseAdmin()

  // ── Fetch current onboarding state first ─────────────────────────────────
  // IMPORTANT: Replace 'clients' below with your actual user/client table name.
  // To find it: SELECT table_name FROM information_schema.tables WHERE table_schema='public';
  const TABLE = 'clients'  // ← change this to match your table

  const { data: current, error: fetchErr } = await sb
    .from(TABLE)
    .select('onboarding')
    .eq('id', userId)
    .single()

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  // Merge new fields with existing — never lose previously set fields
  const merged = { ...(current?.onboarding || {}), ...body }

  const { data: updated, error: updateErr } = await sb
    .from(TABLE)
    .update({ onboarding: merged })
    .eq('id', userId)
    .select('onboarding')
    .single()

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ onboarding: updated.onboarding })
}