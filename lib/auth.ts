import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { getSupabaseAdmin } from './supabase'
import type { JWTPayload, UserRole } from './supabase'

const COOKIE_NAME = 'mk_token'
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production')
}
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

// Returns true if a stored hash is a legacy bcrypt hash that should be
// upgraded to PBKDF2 on the next successful login.
export function passwordNeedsRehash(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith('$2')
}

async function verifyPasswordCrypto(password: string, stored: string): Promise<boolean> {
  try {
    // Legacy bcrypt hashes ($2a/$2b/$2y). bcryptjs is pure-JS and runs on the
    // edge (compareSync needs no RNG — the salt is embedded in the hash).
    // On a successful login the caller rehashes to PBKDF2 (see loginUser).
    if (stored.startsWith('$2')) {
      try { return bcrypt.compareSync(password, stored) } catch { return false }
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

  // 1. Admin — compare against hashed password stored in ADMIN_PASSWORD_HASH env var.
  // To generate the hash, run once: POST /api/setup/verify with your chosen password,
  // or use the hashPassword() function from a one-off script.
  // Falls back to ADMIN_PASSWORD plain-text ONLY during initial setup (no hash set yet).
  if (email === process.env.ADMIN_EMAIL) {
    const adminHash = process.env.ADMIN_PASSWORD_HASH
    let adminMatch = false
    if (adminHash) {
      adminMatch = await verifyPasswordCrypto(password, adminHash)
    } else if (process.env.ADMIN_PASSWORD) {
      // Legacy fallback — set ADMIN_PASSWORD_HASH as soon as possible and remove ADMIN_PASSWORD
      adminMatch = password === process.env.ADMIN_PASSWORD
    }
    if (adminMatch) {
      const token = await signToken({ sub: 'admin', role: 'admin', email, name: 'Admin' })
      return { token, role: 'admin', redirectPath: '/admin', name: 'Admin' }
    }
    return null
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
    // Upgrade legacy bcrypt hash to PBKDF2 now that we have the plaintext.
    if (passwordNeedsRehash(agency.password_hash)) {
      try {
        const newHash = await hashPasswordCrypto(password)
        await sb.from('agencies').update({ password_hash: newHash }).eq('id', agency.id)
      } catch { /* best-effort; don't block login */ }
    }
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
    // Block suspended accounts from logging in entirely
    if (client.status === 'suspended') return { token: '', role: 'client', redirectPath: '', name: '', error: 'suspended' } as any
    // Paused accounts can login but get redirected to paused page
    const token = await signToken({ sub: client.id, role: 'client', email, name: client.name, status: client.status })
    let redirectPath = client.status === 'paused' ? '/paused' : '/dashboard'
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
