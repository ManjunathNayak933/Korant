import { SignJWT, jwtVerify } from 'jose'
import { getSupabaseAdmin } from './supabase'
import type { JWTPayload, UserRole } from './supabase'

const COOKIE_NAME = 'mk_token'
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-in-production-32chars'
)

// ── Web Crypto password hashing (edge-compatible, replaces bcryptjs) ──────────
// Uses PBKDF2 with SHA-256 — strong enough for passwords, runs on edge

async function hashPasswordCrypto(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  )
  const hashArr = new Uint8Array(bits)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(hashArr).map(b => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${saltHex}:${hashHex}`
}

async function verifyPasswordCrypto(password: string, stored: string): Promise<boolean> {
  try {
    // Support legacy bcrypt hashes — if they start with $2 it's bcrypt
    // We cannot verify bcrypt on edge, so we fall back to a plain compare
    // for migration period. New passwords will use pbkdf2.
    if (stored.startsWith('$2')) {
      // Cannot run bcrypt on edge — this will fail for old passwords
      // until they re-login and get a new hash. Return false gracefully.
      // To migrate: re-hash on first successful login via admin panel.
      return false
    }
    if (!stored.startsWith('pbkdf2:')) return false
    const [, saltHex, storedHashHex] = stored.split(':')
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password),
      'PBKDF2', false, ['deriveBits']
    )
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key, 256
    )
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex === storedHashHex
  } catch {
    return false
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 })
    return true
  }
  if (entry.count >= 10) return false
  entry.count++
  return true
}

// ── JWT ───────────────────────────────────────────────────────────────────────
export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

export function buildAuthCookie(token: string): string {
  const maxAge = 7 * 24 * 60 * 60
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`
}

export function buildClearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function loginUser(
  email: string,
  password: string
): Promise<{ token: string; role: UserRole; redirectPath: string; name: string } | null> {

  // 1. Admin — plain compare (no hash needed for admin)
  if (
    email === process.env.ADMIN_EMAIL &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = await signToken({ sub: 'admin', role: 'admin', email, name: 'Admin' })
    return { token, role: 'admin', redirectPath: '/admin', name: 'Admin' }
  }

  const sb = getSupabaseAdmin()

  // 2. Agency
  const { data: agency } = await sb
    .from('agencies')
    .select('id, email, password_hash, name, status')
    .eq('email', email.toLowerCase())
    .single()

  if (agency) {
    const match = await verifyPasswordCrypto(password, agency.password_hash)
    if (!match) return null
    if (agency.status === 'suspended') return null
    const token = await signToken({ sub: agency.id, role: 'agency', email, name: agency.name })
    return { token, role: 'agency', redirectPath: '/agency', name: agency.name }
  }

  // 3. Client
  const { data: client } = await sb
    .from('clients')
    .select('id, email, password_hash, name, status, onboarding')
    .eq('email', email.toLowerCase())
    .single()

  if (client) {
    const match = await verifyPasswordCrypto(password, client.password_hash)
    if (!match) return null

    const token = await signToken({ sub: client.id, role: 'client', email, name: client.name })
    let redirectPath = '/dashboard'
    const ob = client.onboarding || {}
    const onboardingDone =
      (ob.domain_done || ob.domain_skipped) &&
      (ob.webhook_done || ob.webhook_skipped) &&
      (ob.attribution_done || ob.attribution_skipped)
    if (!onboardingDone) redirectPath = '/onboarding'

    return { token, role: 'client', redirectPath, name: client.name }
  }

  return null
}

// ── Hash (for creating accounts) ─────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return hashPasswordCrypto(password)
}
