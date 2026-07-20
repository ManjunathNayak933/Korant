// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/cron/cart-abandonment/route.ts                         │
// │                                                                            │
// │ Runs one pass of the sequence engine: sends whichever step is now due for  │
// │ each open cart, polls Shopify for abandoned checkouts, and expires stale   │
// │ ones. Cloudflare Pages Functions can't hold a native cron trigger, so this │
// │ is an HTTP endpoint hit on a schedule by the companion cron Worker in      │
// │ `worker/cron/` (deploy it separately — see that folder's README notes).    │
// │ Authenticated by CRON_SECRET, so it's safe to expose.                     │
// │                                                                            │
// │ `/api/cron/` IS in PUBLIC_PATHS in middleware.ts — without that, the       │
// │ scheduler (which has no session cookie) is 401'd before reaching this      │
// │ file's own secret check, and no message ever sends.                        │
// │                                                                            │
// │ Trigger it HOURLY. Each cart's send time is baked into next_step_at at the │
// │ brand's chosen IST hour, so an hourly run just picks up whatever is due.   │
// │ The tick is budgeted (MAX_SENDS_PER_RUN) to stay inside Cloudflare's       │
// │ per-invocation subrequest limit; leftovers roll into the next hour and     │
// │ `capped: true` comes back in the response so you can see it happening.     │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { runCartAbandonmentTick } from '@/lib/cart-abandonment'

// Constant-time compare so the secret can't be recovered by timing the response.
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) return false // fail closed if not configured
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const headerKey = request.headers.get('x-cron-secret') || ''
  return safeEqual(bearer, secret) || safeEqual(headerKey, secret)
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runCartAbandonmentTick()
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    // Never 500 silently — the scheduler's only feedback channel is this body.
    console.error('[cron/cart-abandonment] tick failed', e)
    return NextResponse.json({ ok: false, error: e?.message || 'tick failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) { return run(request) }

// Allow GET too (some schedulers only do GET). Same secret gate.
export async function GET(request: NextRequest) { return run(request) }
