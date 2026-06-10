#!/usr/bin/env node
// Offline generator for ADMIN_PASSWORD_HASH.
// Produces the exact PBKDF2 format lib/auth.ts verifies: pbkdf2:<saltHex>:<hashHex>
//
// Usage:
//   node scripts/hash-admin.mjs 'your-strong-admin-password'
//
// Then set the printed value as ADMIN_PASSWORD_HASH in Cloudflare (Settings →
// Environment variables) and REMOVE ADMIN_PASSWORD. Runs entirely locally — the
// password is never sent anywhere.

import { webcrypto as crypto } from 'node:crypto'

const password = process.argv[2]
if (!password || password.length < 12) {
  console.error('Error: pass a password of at least 12 characters.')
  console.error("Usage: node scripts/hash-admin.mjs 'your-strong-admin-password'")
  process.exit(1)
}

const salt = crypto.getRandomValues(new Uint8Array(16))
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
)
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
)
const toHex = (arr) => Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
const hash = `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`

console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n')
console.log('Set this in Cloudflare env, then remove ADMIN_PASSWORD.')
