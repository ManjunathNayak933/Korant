export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

async function refreshGSCToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Token refresh failed')
  return res.json()
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const role = request.headers.get('x-user-role')!
  const clientId = new URL(request.url).searchParams.get('clientId') || userId
  if (role === 'client' && clientId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const { data: conn } = await sb.from('gsc_connections').select('*').eq('client_id', clientId).single()

  if (!conn) return NextResponse.json({ connected: false })

  try {
    let accessToken = conn.access_token
    // Try to get properties; refresh token if needed
    let res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (res.status === 401 && conn.refresh_token) {
      const refreshed = await refreshGSCToken(conn.refresh_token)
      accessToken = refreshed.access_token
      await sb.from('gsc_connections').update({ access_token: accessToken, updated_at: new Date().toISOString() }).eq('client_id', clientId)
      res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    }

    const data = await res.json()
    const properties = (data.siteEntry || []).map((s: any) => ({ url: s.siteUrl, type: s.permissionLevel }))

    return NextResponse.json({
      connected: true,
      property_url: conn.property_url,
      properties,
      connected_at: conn.connected_at,
    })
  } catch {
    return NextResponse.json({ connected: true, property_url: conn.property_url, properties: [], error: 'Failed to fetch properties' })
  }
}

export async function PATCH(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const role = request.headers.get('x-user-role')!
  const body = await request.json()
  const clientId = body.clientId || userId
  if (role === 'client' && clientId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  await sb.from('gsc_connections').update({
    property_url: body.property_url,
    property_type: body.property_type || 'url_prefix',
    updated_at: new Date().toISOString(),
  }).eq('client_id', clientId)

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const role = request.headers.get('x-user-role')!
  const clientId = new URL(request.url).searchParams.get('clientId') || userId
  if (role === 'client' && clientId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()
  await sb.from('gsc_connections').delete().eq('client_id', clientId)
  return NextResponse.json({ ok: true })
}
