// ┌──────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  lib/fetchJson.ts   (NEW FILE)                              │
// │                                                                        │
// │ Typed fetch helper. `await res.json()` gives you `any` (see            │
// │ types/fetch-json.d.ts); this gives you the shape you asked for and     │
// │ turns a non-2xx response into a thrown Error with the server's own     │
// │ message, so callers stop silently rendering error payloads as data.    │
// │                                                                        │
// │   const me = await fetchJson<{ role: string; id: string }>('/api/auth/me')
// └──────────────────────────────────────────────────────────────────────┘

export class HttpError extends Error {
  status: number
  body: any
  constructor(status: number, message: string, body?: any) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export async function fetchJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  let body: any = null
  try { body = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    throw new HttpError(res.status, body?.error || `Request failed (${res.status})`, body)
  }
  return body as T
}

/** Same, but returns null instead of throwing — for non-critical panels. */
export async function tryFetchJson<T = any>(input: string, init?: RequestInit): Promise<T | null> {
  try { return await fetchJson<T>(input, init) } catch { return null }
}
