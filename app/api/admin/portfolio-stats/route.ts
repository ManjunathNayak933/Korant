export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getBaseUrl, baseUrlIsExplicit, originFromRequest } from '@/lib/baseUrl'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()

  const [
    { count: totalClients },
    { count: activeClients },
    { count: totalAgencies },
    { data: planCounts },
    { data: recentEvents },
  ] = await Promise.all([
    sb.from('clients').select('id', { count: 'exact', head: true }),
    sb.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('agencies').select('id', { count: 'exact', head: true }),
    sb.from('clients').select('plan'),
    sb.from('events').select('type, order_value').gte('timestamp', new Date(Date.now() - 30 * 86400000).toISOString()),
  ])

  const basicCount = (planCounts || []).filter(c => c.plan === 'basic').length
  const proCount = (planCounts || []).filter(c => c.plan === 'pro').length

  const clicks = (recentEvents || []).filter(e => e.type === 'click').length
  const sales = (recentEvents || []).filter(e => e.type !== 'click').length
  const revenue = (recentEvents || []).reduce((s, e) => s + (e.order_value || 0), 0)

  const basicPrice = 4249
  const proPrice = 4849
  const mrr = basicCount * basicPrice + proCount * proPrice

  // ── B2: base-URL health ──────────────────────────────────────────────────
  // The Shopify callback registers order + checkout webhooks against this
  // origin. If BASE_URL/NEXT_PUBLIC_BASE_URL is unset (falls back to a hard-
  // coded default) or doesn't match the origin the admin is actually being
  // served from, Shopify posts to the wrong host and captures silently break —
  // exactly the "0 rows" symptom. Surface it here so it shows in /admin.
  const resolvedBaseUrl = getBaseUrl()
  const requestOrigin = originFromRequest(request)
  const explicit = baseUrlIsExplicit()
  const originMismatch =
    !!requestOrigin && !resolvedBaseUrl.toLowerCase().includes(
      requestOrigin.replace(/^https?:\/\//, '').toLowerCase()
    )
  const configHealth = {
    ok: explicit && !originMismatch,
    baseUrl: resolvedBaseUrl,
    requestOrigin,
    baseUrlSet: explicit,
    originMismatch,
    message: !explicit
      ? `BASE_URL is not set — the app is falling back to ${resolvedBaseUrl}. Shopify order/checkout webhooks will register against that host, so captures may silently fail. Set BASE_URL (and NEXT_PUBLIC_BASE_URL) to your real origin${requestOrigin ? ` (${requestOrigin})` : ''}, redeploy, then re-run each brand's Shopify connect.`
      : originMismatch
        ? `Base URL is ${resolvedBaseUrl} but this page is served from ${requestOrigin}. Shopify webhooks may be registering against the wrong host. Align BASE_URL/NEXT_PUBLIC_BASE_URL with ${requestOrigin}, redeploy, and reconnect Shopify.`
        : `Base URL OK — ${resolvedBaseUrl}`,
  }

  return NextResponse.json({
    mrr,
    totalClients: totalClients || 0,
    activeClients: activeClients || 0,
    totalAgencies: totalAgencies || 0,
    platformClicks: clicks,
    platformSales: sales,
    platformRevenue: revenue,
    basicClients: basicCount,
    proClients: proCount,
    configHealth,
  })
}
