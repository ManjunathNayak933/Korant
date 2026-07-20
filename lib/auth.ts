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
// Backed by Cloudflare KV (METRICS_CACHE) so the limit is GLOBAL across edge
// isolates. The old module-level Map only limited within a single isolate, so
// an attacker hitting different POPs/isolates bypassed it. Falls back to an
// in-memory Map for local dev (no KV binding).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

function getRateLimitKV(): any | null {
  try { return (globalThis as any).METRICS_CACHE ?? null } catch { return null }
}

export async function checkRateLimit(key: string): Promise<boolean> {
  const now = Date.now()
  const kv = getRateLimitKV()

  if (kv) {
    const kvKey = `rl:${key}`
    try {
      const raw = await kv.get(kvKey)
      const entry = raw ? JSON.parse(raw) as { count: number; resetAt: number } : null
      if (!entry || now > entry.resetAt) {
        const resetAt = now + RATE_LIMIT_WINDOW_MS
        await kv.put(kvKey, JSON.stringify({ count: 1, resetAt }), { expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) })
        return true
      }
      if (entry.count >= RATE_LIMIT_MAX) return false
      entry.count++
      // Keep the original window expiry; recompute TTL from remaining time.
      const ttl = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      await kv.put(kvKey, JSON.stringify(entry), { expirationTtl: ttl })
      return true
    } catch {
      // KV hiccup — fail open rather than lock everyone out.
      return true
    }
  }

  // Local dev fallback (single isolate).
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// Per-ACCOUNT limiter for login. IP-only limiting doesn't stop a distributed
// password-spray against one mailbox: every request comes from a different
// address, so each one sees a fresh counter. Keyed on the email (hashed, so
// addresses never sit in KV in the clear) with a tighter budget than the IP
// limiter, because a real person doesn't need 10 tries at one account.
const ACCOUNT_LIMIT_MAX = 5

async function hashKey(value: string): Promise<string> {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bits)).slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function checkAccountRateLimit(email: string): Promise<boolean> {
  const now = Date.now()
  const key = `rl:acct:${await hashKey(email.trim().toLowerCase())}`
  const kv = getRateLimitKV()

  if (kv) {
    try {
      const raw = await kv.get(key)
      const entry = raw ? JSON.parse(raw) as { count: number; resetAt: number } : null
      if (!entry || now > entry.resetAt) {
        await kv.put(key, JSON.stringify({ count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }),
          { expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) })
        return true
      }
      if (entry.count >= ACCOUNT_LIMIT_MAX) return false
      entry.count++
      await kv.put(key, JSON.stringify(entry),
        { expirationTtl: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) })
      return true
    } catch {
      return true // KV hiccup — fail open rather than lock the account out
    }
  }

  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= ACCOUNT_LIMIT_MAX) return false
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

// `Secure` must match the cookie that was SET, or some browsers refuse to
// overwrite it and the session cookie survives logout on the client side.
export function buildClearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function loginUser(
  email: string,
  password: string
): Promise<{ token: string; role: UserRole; redirectPath: string; name: string } | null> {

  // 1. Admin — compare against the PBKDF2 hash in ADMIN_PASSWORD_HASH.
  // Generate it with: node -e "..." using hashPassword(), or any PBKDF2-SHA256
  // (100k iterations) tool producing `pbkdf2:<saltHex>:<hashHex>`.
  //
  // The plain-text ADMIN_PASSWORD fallback is now DEV-ONLY. It previously
  // worked in production, where it compared the submitted password to an env
  // var with `===` — no hashing, not constant-time, and it made the admin
  // account (which can read every tenant's data) only as safe as an env var
  // pasted into a dashboard. In production, no hash means no admin login.
  if (email === process.env.ADMIN_EMAIL) {
    const adminHash = process.env.ADMIN_PASSWORD_HASH
    let adminMatch = false
    if (adminHash) {
      adminMatch = await verifyPasswordCrypto(password, adminHash)
    } else if (process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== 'production') {
      // Local/dev bootstrap only. Constant-time compare so the dev path doesn't
      // teach the wrong pattern.
      const a = password, b = process.env.ADMIN_PASSWORD
      let r = a.length === b.length ? 0 : 1
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
      }
      adminMatch = r === 0
    } else if (process.env.ADMIN_PASSWORD) {
      console.error('[auth] ADMIN_PASSWORD is set but ADMIN_PASSWORD_HASH is not. ' +
        'Plain-text admin login is disabled in production — set ADMIN_PASSWORD_HASH.')
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

// ── OAuth state (CSRF protection for GSC / external OAuth) ────────────────────
// The `state` param must be an unguessable, single-use value bound to the
// logged-in client. We sign a short-lived JWT containing the clientId plus a
// random nonce, send it as `state`, and also drop the nonce in an httpOnly
// cookie. On callback we verify the signature AND that the cookie nonce
// matches — so a forged callback (attacker-chosen state) is rejected.

const OAUTH_STATE_COOKIE = 'mk_oauth_state'

export async function signOAuthState(clientId: string): Promise<{ state: string; cookie: string }> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const state = await new SignJWT({ clientId, nonce, purpose: 'gsc_oauth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(JWT_SECRET)
  // 10-minute httpOnly cookie carrying the nonce for cross-request verification.
  const cookie = `${OAUTH_STATE_COOKIE}=${nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`
  return { state, cookie }
}

// Verifies the signed state and matches it against the cookie nonce.
// Returns the clientId on success, or null if anything fails (tampered state,
// expired, wrong purpose, or nonce mismatch / missing cookie).
export async function verifyOAuthState(
  state: string | null,
  cookieNonce: string | null
): Promise<string | null> {
  if (!state || !cookieNonce) return null
  try {
    const { payload } = await jwtVerify(state, JWT_SECRET)
    const p = payload as any
    if (p.purpose !== 'gsc_oauth') return null
    if (p.nonce !== cookieNonce) return null
    return typeof p.clientId === 'string' ? p.clientId : null
  } catch {
    return null
  }
}

// Same reasoning as buildClearCookie: attributes must match the Set-Cookie
// that created it (signOAuthState sets Secure) for the clear to take effect.
export function buildClearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`
}
