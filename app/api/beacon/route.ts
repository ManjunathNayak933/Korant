export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@cloudflare/next-on-pages'
import { getVisitorCookie, detectEntrySource } from '@/lib/visitor'
import { getSupabaseAdmin } from '@/lib/supabase'
import { enqueueEvent, writeEventDirect, isVisitorKnown, type TrackEvent } from '@/lib/event-queue'

// CORS — this endpoint is called from the client's own store domain
function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

const PIXEL_HEADERS = (req: NextRequest) => ({
  ...corsHeaders(req),
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store',
})

function pixel(req: NextRequest) {
  return new NextResponse('1x1', { status: 200, headers: PIXEL_HEADERS(req) })
}

// Run a promise after the response is sent (non-blocking), like the redirect does.
function background(p: Promise<unknown>) {
  try { getRequestContext().ctx.waitUntil(p) } catch { void p }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('cid')
    const page = searchParams.get('p') || ''
    const eventType = searchParams.get('e') || 'pageview' // pageview | purchase | cart

    if (!clientId) return pixel(request)

    const visitorId = getVisitorCookie(request)
    // New visitor with no tracking link → organic/direct, no cookie yet. Nothing
    // to attribute (we only track visitors who arrived via a known link).
    if (!visitorId) return pixel(request)

    const sb = getSupabaseAdmin()
    // ONE read of visitor_first_touch — and we cache the "this visitor is known"
    // fact in KV, because once a first-touch row exists it never disappears.
    // That turns ~450M gate reads/month into mostly-free KV hits. (Previously
    // this table was read twice per pageview — here and inside recordTouchpoint.)
    const known = await isVisitorKnown(clientId, visitorId, sb, background)
    if (!known) return pixel(request) // unknown visitor → no journey noise

    const entrySource = detectEntrySource(request)
    const channel =
      entrySource === 'organic_search' ? 'organic' :
      entrySource === 'social' ? 'social' :
      entrySource === 'email' ? 'email' : 'direct'

    const event: TrackEvent = {
      v: 1,
      kind: eventType === 'purchase' ? 'purchase' : 'pageview',
      clientId,
      visitorId,
      channel,
      entrySource,
      page,
      ts: new Date().toISOString(),
    }

    // Hot path: enqueue and return the pixel immediately. The actual DB writes
    // (journey_touchpoints insert + visitor_first_touch counter update, plus the
    // purchase events row) happen in the batch consumer.
    const queued = await enqueueEvent(event, background)

    // Fallback: if no queue is configured, write directly in the background so
    // behaviour is identical to before. The pixel still returns without waiting.
    if (!queued) background(writeEventDirect(event))

    return pixel(request)
  } catch (err) {
    console.error('beacon error:', err)
    return new NextResponse('1x1', { status: 200, headers: { 'Content-Type': 'image/gif' } })
  }
}
