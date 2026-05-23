export const runtime = 'edge'
// ONE-TIME USE: Generate ADMIN_PASSWORD_HASH for .env
// After running this once and setting the env var, this endpoint does nothing.
// Returns the hash only if ADMIN_PASSWORD_HASH is NOT yet set in env.
import { NextRequest, NextResponse } from 'next/server'
import { hashPassword } from '@/lib/auth'

export async function POST(request: NextRequest) {
  // Only works if hash isn't set yet — prevents misuse once configured
  if (process.env.ADMIN_PASSWORD_HASH) {
    return NextResponse.json({ error: 'Already configured. Remove this endpoint.' }, { status: 403 })
  }
  const { password } = await request.json()
  if (!password || password.length < 12) {
    return NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 })
  }
  const hash = await hashPassword(password)
  return NextResponse.json({
    hash,
    instruction: 'Add this to your Cloudflare env as ADMIN_PASSWORD_HASH, then remove ADMIN_PASSWORD',
  })
}
