// Simple in-memory cache — KV can be added back once site is live
const memCache = new Map<string, { value: string; exp: number }>()

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const entry = memCache.get(key)
    if (!entry) return null
    if (Date.now() > entry.exp) { memCache.delete(key); return null }
    return JSON.parse(entry.value) as T
  } catch { return null }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 120): Promise<void> {
  try {
    memCache.set(key, { value: JSON.stringify(value), exp: Date.now() + ttlSeconds * 1000 })
  } catch {}
}

export async function cacheDel(key: string): Promise<void> {
  memCache.delete(key)
}

export async function cacheDelPrefix(prefix: string): Promise<void> {
  for (const key of memCache.keys()) {
    if (key.startsWith(prefix)) memCache.delete(key)
  }
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
