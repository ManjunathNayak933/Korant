// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  worker/cron/index.ts   (NEW)                                   │
// │                                                                            │
// │ The scheduler that was missing. Pages Functions have no cron trigger, so   │
// │ the cart-abandonment tick had no caller at all — carts were captured and   │
// │ scheduled, and then nothing ever ran. This Worker fires hourly and calls   │
// │ the app endpoint with the shared CRON_SECRET.                              │
// │                                                                            │
// │ It also exposes a fetch handler behind the same secret so you can trigger  │
// │ a run by hand while testing:                                               │
// │   curl -H "x-cron-secret: $CRON_SECRET" https://korant-cron.<sub>.workers.dev/
// └──────────────────────────────────────────────────────────────────────────┘

export interface Env {
  KORANT_BASE_URL: string
  CRON_SECRET: string
}

async function tick(env: Env): Promise<{ status: number; body: string }> {
  const url = `${env.KORANT_BASE_URL.replace(/\/+$/, '')}/api/cron/cart-abandonment`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CRON_SECRET}`,
      'x-cron-secret': env.CRON_SECRET,
      'Content-Type': 'application/json',
    },
  })
  const body = await res.text()
  if (!res.ok) {
    console.error('[korant-cron] tick failed', res.status, body.slice(0, 500))
  } else {
    // e.g. {"ok":true,"processed":42,"sent":40,"failed":1,"expired":3,"held":0,"capped":false}
    console.log('[korant-cron] tick ok', body.slice(0, 500))
  }
  return { status: res.status, body }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env).then(() => {}))
  },

  // Manual trigger for testing. Same secret gate as the app endpoint.
  async fetch(request: Request, env: Env): Promise<Response> {
    const provided = request.headers.get('x-cron-secret')
      || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }
    const r = await tick(env)
    return new Response(r.body, {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
