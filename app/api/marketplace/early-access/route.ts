// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/marketplace/early-access/route.ts                      │
// │                                                                            │
// │ BUG FIX: the old try/catch was dead code. supabase-js RESOLVES with        │
// │ { data, error } — it does not throw — so a duplicate-email insert          │
// │ returned 23505 in `error`, the catch never ran, and the route replied      │
// │ "Added to waitlist" for a row that was never written. The duplicate case   │
// │ is now detected properly and every other failure is surfaced.              │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Deliberately permissive — enough to reject obvious junk without bouncing
// valid but unusual addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { email, name, brand } = body
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return NextResponse.json({ error: 'email required' }, { status: 400 })
  if (!EMAIL_RE.test(normalized)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { error } = await sb.from('marketplace_waitlist').insert({
    email: normalized,
    name: name ? String(name).slice(0, 200) : null,
    brand: brand ? String(brand).slice(0, 200) : null,
    created_at: new Date().toISOString(),
  })

  if (error) {
    // 23505 = unique_violation. Already on the list is a success from the
    // visitor's point of view, so don't scare them with an error.
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, message: 'You are already on the waitlist' })
    }
    console.error('[marketplace/early-access] insert failed', error)
    return NextResponse.json({ error: 'Could not add you to the waitlist. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, message: 'Added to waitlist' })
}
