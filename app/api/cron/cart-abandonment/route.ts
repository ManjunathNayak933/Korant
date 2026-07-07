// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/cron/cart-abandonment/route.ts   (NEW FILE)             │
// │ Create at <repo-root>/app/api/cron/cart-abandonment/route.ts               │
// │                                                                            │
// │ Runs one pass of the sequence engine: sends whichever step is now due for  │
// │ each open cart, and expires stale ones. Cloudflare Pages Functions can't    │
// │ hold a native cron trigger, so this is an HTTP endpoint hit on a schedule   │
// │ by a tiny cron Worker (or any external scheduler). It is authenticated by   │
// │ CRON_SECRET, so it's safe to expose.                                       │
// │                                                                            │
// │ ⚠️ Add `/api/cron/` to PUBLIC_PATHS in middleware.ts (see the patch file),  │
// │    otherwise middleware 401s it for having no user session.                │
// │                                                                            │
// │ Trigger it HOURLY. Because each cart's send time is baked into             │
// │ next_step_at at the brand's chosen hour, an hourly run simply picks up      │
// │ whatever is due — brands still only ever get messaged at their chosen hour.│
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { runCartAbandonmentTick } from '@/lib/cart-abandonment'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) return false // fail closed if not configured
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const headerKey = request.headers.get('x-cron-secret') || ''
  return bearer === secret || headerKey === secret
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runCartAbandonmentTick()
  return NextResponse.json({ ok: true, ...result })
}

// Allow GET too (some schedulers only do GET). Same secret gate.
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runCartAbandonmentTick()
  return NextResponse.json({ ok: true, ...result })
}
