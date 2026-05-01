export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const clientId = searchParams.get('state')

  if (!code || !clientId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?gsc=error`)
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/gsc/callback`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?gsc=error`)
  }

  const tokens = await tokenRes.json()
  const sb = getSupabaseAdmin()

  await sb.from('gsc_connections').upsert({
    client_id: clientId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || '',
    property_url: '',
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' })

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?gsc=connected&tab=search`)
}
