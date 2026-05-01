export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { loginUser, buildAuthCookie, checkRateLimit } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown'
    if (!checkRateLimit(`login:${ip}`)) {
      return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
    }

    const result = await loginUser(email.trim(), password)
    if (!result) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
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
