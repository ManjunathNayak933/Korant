export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getVisitorCookie, detectEntrySource, recordTouchpoint } from '@/lib/visitor'
import { getSupabaseAdmin } from '@/lib/supabase'

// CORS — this endpoint is called from client's own store domain
function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('cid')
    const page     = searchParams.get('p') || ''
    const eventType = searchParams.get('e') || 'pageview' // pageview, purchase, cart

    if (!clientId) {
      return new NextResponse('1x1', { status: 200, headers: { ...corsHeaders(request), 'Content-Type': 'image/gif' } })
    }

    const visitorId = getVisitorCookie(request)
    if (!visitorId) {
      // New visitor with no tracking link — organic/direct, no cookie yet
      return new NextResponse('1x1', { status: 200, headers: { ...corsHeaders(request), 'Content-Type': 'image/gif' } })
    }

    const entrySource = detectEntrySource(request)

    // Check if this visitor has been seen before
    const sb = getSupabaseAdmin()
    const { data: firstTouch } = await sb
      .from('visitor_first_touch')
      .select('first_seen_at, first_channel, converted')
      .eq('client_id', clientId)
      .eq('visitor_id', visitorId)
      .single()

    if (!firstTouch) {
      return new NextResponse('1x1', { status: 200, headers: { ...corsHeaders(request), 'Content-Type': 'image/gif' } })
    }

    const isReturnVisit = true
    const channel = entrySource === 'organic_search' ? 'organic' :
                    entrySource === 'social' ? 'social' :
                    entrySource === 'email' ? 'email' : 'direct'

    await recordTouchpoint({
      clientId,
      visitorId,
      channel,
      eventType: eventType === 'purchase' ? 'purchase' : 'return_visit',
      entrySource,
      isReturnVisit,
    })

    // If purchase event, mark converted
    if (eventType === 'purchase' && !firstTouch.converted) {
      const { markVisitorConverted } = await import('@/lib/visitor')
      await markVisitorConverted(clientId, visitorId)
    }

    // Also record in events table for existing analytics
    if (eventType === 'purchase') {
      await sb.from('events').insert({
        client_id:       clientId,
        type:            'cookie_sale',
        visitor_id:      visitorId,
        is_return_visit: true,
        entry_source:    entrySource,
        first_channel:   firstTouch.first_channel,
        timestamp:       new Date().toISOString(),
      })
    }

    return new NextResponse('1x1', {
      status: 200,
      headers: { ...corsHeaders(request), 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }
    })
  } catch (err) {
    console.error('beacon error:', err)
    return new NextResponse('1x1', { status: 200, headers: { 'Content-Type': 'image/gif' } })
  }
}