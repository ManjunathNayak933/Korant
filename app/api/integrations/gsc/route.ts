export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const clientId = new URL(request.url).searchParams.get('clientId') || userId

  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/gsc/callback`
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: clientId,
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
