export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-user-id')
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, storeUrl, trackingDomain } = await req.json()
  const sb = getSupabaseAdmin()

  switch (type) {

    // ── 1. Custom domain CNAME ────────────────────────────────────────────────
    case 'domain': {
      if (!trackingDomain) return NextResponse.json({ ok: false, message: 'No tracking domain provided' })
      try {
        const res  = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(trackingDomain)}&type=CNAME`)
        const data = await res.json()
        const answers: string[] = (data.Answer || []).map((a: any) => a.data?.toLowerCase() || '')
        const ok = answers.some(a => a.includes('microkorant.in') || a.includes('korant'))
        return NextResponse.json({
          ok,
          message: ok
            ? `CNAME verified — ${trackingDomain} points correctly`
            : answers.length
              ? `CNAME found but points to ${answers[0].replace(/\.$/, '')} — should point to tracking.microkorant.in`
              : 'No CNAME record found. Check your DNS settings.',
        })
      } catch {
        return NextResponse.json({ ok: false, message: 'DNS lookup failed — try again in a moment' })
      }
    }

    // ── 2. Store tracking script (beacon + attribution unified) ───────────────
    case 'tracking': {
      if (!storeUrl) return NextResponse.json({ ok: false, message: 'No store URL provided' })
      try {
        const url = storeUrl.startsWith('http') ? storeUrl : `https://${storeUrl}`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'MicroKorant-Verifier/1.0' },
          signal:  AbortSignal.timeout(8000),
        })
        if (!res.ok) return NextResponse.json({ ok: false, message: `Store returned ${res.status} — ensure the URL is public` })
        const html = await res.text()
        // Check for our beacon/tracking script markers
        const markers = ['microkorant', '/api/beacon', 'kv_id', 'kv_partner', 'korant-tracking']
        const found   = markers.find(m => html.includes(m))
        return NextResponse.json({
          ok:      !!found,
          message: found
            ? 'Tracking script detected on your store ✓'
            : 'Script not found. Paste the tracking snippet into your store theme before </body>.',
        })
      } catch (e: any) {
        return NextResponse.json({
          ok:      false,
          message: e?.name === 'TimeoutError'
            ? 'Store took too long to respond — check the URL and try again'
            : `Could not reach store: ${storeUrl}`,
        })
      }
    }

    // ── 3. Store webhook (check if any events arrived from this client) ───────
    case 'webhook': {
      const { count } = await sb
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      const ok = (count || 0) > 0
      return NextResponse.json({
        ok,
        message: ok
          ? `Webhook active — ${count} event${count === 1 ? '' : 's'} received in the last 7 days ✓`
          : 'No events received yet. Share a tracking link and make a test click.',
      })
    }

    // ── 4. WhatsApp — check phone number is configured ────────────────────────
    case 'whatsapp': {
      const { data } = await sb
        .from('whatsapp_configs')
        .select('phone_number_id, phone_display')
        .eq('client_id', clientId)
        .maybeSingle()
      const ok = !!data?.phone_number_id
      return NextResponse.json({
        ok,
        message: ok
          ? `WhatsApp connected — ${data.phone_display || data.phone_number_id} ✓`
          : 'WhatsApp not connected. Add your phone number ID in the WhatsApp settings.',
      })
    }

    // ── 5. Analytics (GSC) — check token exists ───────────────────────────────
    case 'analytics': {
      const { data } = await sb
        .from('gsc_connections')
        .select('connected_at')
        .eq('client_id', clientId)
        .maybeSingle()
      const ok = !!data
      return NextResponse.json({
        ok,
        message: ok
          ? `Google Search Console connected (${new Date(data.connected_at).toLocaleDateString()}) ✓`
          : 'Google Search Console not connected. Connect via the Search Console tab.',
      })
    }

    // ── 6. Beacon live check — did the beacon fire for this client? ───────────
    case 'beacon': {
      const { count } = await sb
        .from('journey_touchpoints')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      const ok = (count || 0) > 0
      return NextResponse.json({
        ok,
        message: ok
          ? `Beacon active — ${count} visitor touchpoint${count === 1 ? '' : 's'} received in the last 7 days ✓`
          : 'No beacon data yet. Ensure the tracking script is live on your store and visit a page.',
      })
    }

    default:
      return NextResponse.json({ error: 'Unknown check type' }, { status: 400 })
  }
}
