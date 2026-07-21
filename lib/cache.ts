// Cache using Cloudflare KV (METRICS_CACHE binding) with in-memory fallback for local dev.
// KV reads: free up to 100k/day. Writes: ~$0.50 per million — negligible.
// This replaces the old in-memory Map which was useless on edge (each worker has its own memory).
// All three access paths are tried now, cheapest first, so this works on Pages,
// on a plain Worker, and in `next dev`.
import { getRequestContext } from '@cloudflare/next-on-pages'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getKV(): any | null {
  // 1) The documented next-on-pages path. The IMPORT is static (a `require`
  // here would break under the edge runtime, which is ESM-only); it's the CALL
  // that throws outside a request context, and in `next dev` without the CF
  // adapter — hence the try/catch rather than a lazy import.
  try {
    // `as any`: CloudflareEnv is generated from wrangler.toml at build time and
    // won't carry the binding in every environment (e.g. `next dev`).
    const kv = (getRequestContext()?.env as any)?.METRICS_CACHE
    if (kv) return kv
  } catch { /* not in a CF request context — fall through */ }

  // 2) next-on-pages v1 also mirrors bindings onto process.env.
  try {
    const kv = (process.env as any)?.METRICS_CACHE
    // A real binding is an object with .get(); a stray string env var is not.
    if (kv && typeof kv.get === 'function') return kv
  } catch { /* ignore */ }

  // 3) Plain module/service worker.
  try {
    const kv = (globalThis as any).METRICS_CACHE
    if (kv && typeof kv.get === 'function') return kv
  } catch { /* ignore */ }

  return null
}

// Local dev fallback
const memCache = new Map<string, { value: string; exp: number }>()

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const kv = getKV()
    if (kv) {
      const val = await kv.get(key)
      return val ? (JSON.parse(val) as T) : null
    }
    // Local fallback
    const entry = memCache.get(key)
    if (!entry) return null
    if (Date.now() > entry.exp) { memCache.delete(key); return null }
    return JSON.parse(entry.value) as T
  } catch { return null }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 120): Promise<void> {
  try {
    const kv = getKV()
    if (kv) {
      await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
      return
    }
    // Local fallback
    memCache.set(key, { value: JSON.stringify(value), exp: Date.now() + ttlSeconds * 1000 })
  } catch {}
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const kv = getKV()
    if (kv) { await kv.delete(key); return }
    memCache.delete(key)
  } catch {}
}

export async function cacheDelPrefix(prefix: string): Promise<void> {
  try {
    const kv = getKV()
    if (kv) {
      // KV list + delete — only runs on cache invalidation (rare), not hot path
      const list = await kv.list({ prefix })
      await Promise.all(list.keys.map(k => kv.delete(k.name)))
      return
    }
    for (const key of memCache.keys()) {
      if (key.startsWith(prefix)) memCache.delete(key)
    }
  } catch {}
}

export function metricsKey(clientId: string, month?: string, campaignId?: string): string {
  const parts = ['metrics', clientId, month || 'all']
  if (campaignId) parts.push(campaignId)
  return parts.join(':')
}

export function listKey(type: string, clientId: string): string {
  return `list:${type}:${clientId}`
}

export async function invalidateClientMetrics(clientId: string): Promise<void> {
  await cacheDelPrefix(`metrics:${clientId}:`)
}
