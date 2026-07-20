// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  app/api/auth/login/route.ts                                    │
// │                                                                            │
// │ Rate limiting is now two-dimensional. IP-only limiting (the previous       │
// │ behaviour) doesn't stop a distributed password spray: 10,000 hosts each    │
// │ trying one password against one mailbox never trip a per-IP counter. The   │
// │ per-account limiter closes that; the per-IP limiter still stops one host   │
// │ enumerating many accounts.                                                 │
// └──────────────────────────────────────────────────────────────────────────┘
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { loginUser, buildAuthCookie, checkRateLimit, checkAccountRateLimit } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown'

    // Both limits are checked before any password work happens.
    const [ipOk, acctOk] = await Promise.all([
      checkRateLimit(`login:${ip}`),
      checkAccountRateLimit(String(email)),
    ])
    if (!ipOk || !acctOk) {
      // Deliberately the same message for both, so the response doesn't reveal
      // whether the account or the address hit the limit.
      return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
    }

    const result = await loginUser(email.trim(), password)
    if (!result) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    // Account suspended - cannot login
    if ((result as any).error === 'suspended') {
      return NextResponse.json({ error: 'Your account has been suspended. Please contact support.' }, { status: 403 })
    }

    const { token, role, redirectPath, name } = result
    const res = NextResponse.json({ role, redirectPath, name })
    res.headers.set('Set-Cookie', buildAuthCookie(token))
    return res
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
