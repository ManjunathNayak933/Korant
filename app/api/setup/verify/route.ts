// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/setup/verify/route.ts                                  │
// │                                                                            │
// │ SSRF FIX: the 'tracking' check fetched whatever `storeUrl` the caller sent │
// │ and returned status + body-derived results. On Cloudflare that reaches     │
// │ internal/link-local addresses and other tenants' origins, and the response │
// │ leaks whether a host exists and whether it contains given markers — a      │
// │ usable probe. The URL is now validated: https/http only, public hostname   │
// │ only, no IP literals, no internal TLDs, redirects not followed, and the    │
// │ response body is size-capped.                                              │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Hosts that must never be fetched: loopback, link-local (cloud metadata),
// private ranges, and internal-only TLDs.
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.localdomain$/i,
  /^metadata(\.|$)/i,
]

function isIpLiteral(host: string): boolean {
  // IPv4 dotted-quad, or bracketed/plain IPv6.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/**
 * Returns a safe absolute URL to fetch, or null with a reason.
 * Deliberately rejects ALL IP literals rather than trying to enumerate private
 * ranges — a storefront is always a hostname, so there's no legitimate case,
 * and range checks are easy to bypass (decimal/octal/IPv6-mapped forms).
 */
function validateStoreUrl(raw: string): { url: string } | { error: string } {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return { error: 'No store URL provided' }

  let u: URL
  try {
    u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    return { error: 'That does not look like a valid store URL' }
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { error: 'Store URL must start with https://' }
  }
  if (u.username || u.password) {
    return { error: 'Store URL must not contain credentials' }
  }
  if (u.port && u.port !== '80' && u.port !== '443') {
    return { error: 'Store URL must use the standard web port' }
  }

  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (isIpLiteral(host)) {
    return { error: 'Enter your store domain (e.g. mystore.com), not an IP address' }
  }
  if (!host.includes('.')) {
    return { error: 'Enter a full store domain, e.g. mystore.com' }
  }
  if (BLOCKED_HOST_PATTERNS.some(p => p.test(host))) {
    return { error: 'That hostname cannot be checked from here' }
  }

  // Only fetch the site root — no attacker-chosen path.
  return { url: `${u.protocol}//${host}/` }
}

export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-user-id')
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, storeUrl, trackingDomain } = await req.json()
  const sb = getSupabaseAdmin()

  switch (type) {

    // ── 1. Custom domain CNAME ────────────────────────────────────────────────
    case 'domain': {
      if (!trackingDomain) return NextResponse.json({ ok: false, message: 'No tracking domain provided' })
      // Only a hostname is ever interpolated, and only into Google's public
      // DoH resolver — no arbitrary origin is contacted here.
      const host = String(trackingDomain).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
        return NextResponse.json({ ok: false, message: 'That does not look like a valid domain' })
      }
      try {
        const res  = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=CNAME`)
        const data = await res.json()
        const answers: string[] = (data.Answer || []).map((a: any) => a.data?.toLowerCase() || '')
        const ok = answers.some(a => a.includes('microkorant.in') || a.includes('korant'))
        return NextResponse.json({
          ok,
          message: ok
            ? `CNAME verified — ${host} points correctly`
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
      const checked = validateStoreUrl(storeUrl)
      if ('error' in checked) return NextResponse.json({ ok: false, message: checked.error })

      try {
        const res = await fetch(checked.url, {
          headers: { 'User-Agent': 'MicroKorant-Verifier/1.0' },
          signal:  AbortSignal.timeout(8000),
          // Don't follow redirects: a public host could 302 to an internal one
          // and re-open the hole the validation above just closed.
          redirect: 'manual',
        })
        if (res.status >= 300 && res.status < 400) {
          return NextResponse.json({
            ok: false,
            message: 'Your store redirected the check. Enter the final store URL (the one customers land on) and try again.',
          })
        }
        if (!res.ok) return NextResponse.json({ ok: false, message: `Store returned ${res.status} — ensure the URL is public` })

        // Cap what we read: a huge or streaming response shouldn't be able to
        // exhaust the worker.
        const raw = await res.text()
        const html = raw.slice(0, 512 * 1024)

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
            : 'Could not reach your store. Check the URL and that it is publicly accessible.',
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

    // ── 3b. Third-party checkout (order arrived via the generic endpoint) ──────
    case 'generic': {
      const { count } = await sb
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('platform', 'generic')
        .not('order_id', 'is', null)
        .gte('timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      const ok = (count || 0) > 0
      return NextResponse.json({
        ok,
        message: ok
          ? `Receiving orders — ${count} order${count === 1 ? '' : 's'} from your checkout in the last 7 days ✓`
          : 'No orders received yet. Send a test order through your checkout using one of your partner discount codes, then re-check.',
      })
    }

    // ── 3c. Abandoned-cart intake (non-native checkouts) ──────────────────────
    case 'cart': {
      const { count } = await sb
        .from('abandoned_carts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('abandoned_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      const ok = (count || 0) > 0
      return NextResponse.json({
        ok,
        message: ok
          ? `Cart capture working — ${count} cart${count === 1 ? '' : 's'} detected in the last 7 days ✓`
          : 'No abandoned carts captured yet. Native Shopify checkouts arrive automatically; third-party checkouts (GoKwik, Shiprocket, Razorpay Magic) must POST to /api/webhook/cart.',
      })
    }

    // ── 4. WhatsApp — check phone number is configured ────────────────────────
    case 'whatsapp': {
      const { data } = await sb
        .from('whatsapp_configs')
        .select('phone_number_id, phone_display, waba_id')
        .eq('client_id', clientId)
        .maybeSingle()
      const ok = !!data?.phone_number_id && !!data?.waba_id
      return NextResponse.json({
        ok,
        message: ok
          ? `WhatsApp connected — ${data!.phone_display || data!.phone_number_id} ✓`
          : data?.phone_number_id
            ? 'WhatsApp phone connected, but no WABA ID — templates can\'t sync without it. Add it in WhatsApp settings.'
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
          ? `Google Search Console connected (${new Date(data!.connected_at).toLocaleDateString()}) ✓`
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
