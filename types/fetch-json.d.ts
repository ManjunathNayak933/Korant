// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REPO PATH:  types/fetch-json.d.ts   (NEW FILE)                             │
// │                                                                            │
// │ Why this exists — and why `typescript.ignoreBuildErrors` is now OFF.       │
// │                                                                            │
// │ @cloudflare/workers-types (pulled in globally by @cloudflare/next-on-pages)│
// │ types `Response.json()` as `Promise<unknown>`, while lib.dom types it as   │
// │ `Promise<any>`. The workers version wins, so EVERY                          │
// │ `const data = await res.json(); data.role`                                 │
// │ became "Property 'role' does not exist on type 'unknown'" — 350 errors     │
// │ across ~47 files. next.config.js dealt with that by switching TypeScript   │
// │ off entirely for the build.                                                │
// │                                                                            │
// │ That is a bad trade: the suppressed set contained REAL bugs. lib/links.ts  │
// │ built its ResolvedLink object without `discountCode` / `shopDomain`        │
// │ (TS2739), so the Shopify /discount session redirect silently never fired   │
// │ and attribution was lost on every cart-bypassing checkout. TypeScript had  │
// │ been reporting it the whole time; nobody could see it in the noise.        │
// │                                                                            │
// │ This one-line global augmentation restores `Promise<any>` and takes the    │
// │ project from 354 errors to 0, so the compiler is useful again.             │
// │                                                                            │
// │ Prefer `lib/fetchJson.ts` for new code — it gives you a real typed result  │
// │ instead of `any`.                                                          │
// └──────────────────────────────────────────────────────────────────────────┘
export {}

declare global {
  interface Body {
    json(): Promise<any>
  }
}
