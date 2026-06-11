export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verifyOAuthState, buildClearOAuthStateCookie } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  // CSRF: the clientId comes from the *verified* signed state, matched against
  // the httpOnly nonce cookie — never from an attacker-controllable raw param.
  const cookieNonce = request.cookies.get('mk_oauth_state')?.value || null
  const clientId = await verifyOAuthState(state, cookieNonce)

  if (!code || !clientId) {
    const res = NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?gsc=error`)
    res.headers.set('Set-Cookie', buildClearOAuthStateCookie())
    return res
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
    const res = NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?gsc=error`)
    res.headers.set('Set-Cookie', buildClearOAuthStateCookie())
    return res
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

  const res = NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?gsc=connected&tab=search`)
  res.headers.set('Set-Cookie', buildClearOAuthStateCookie())
  return res
}
