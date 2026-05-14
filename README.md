# Korant — Attribution Platform

Multi-tenant SaaS for tracking influencer, SEO, and affiliate marketing performance.

## Stack
- **Framework**: Next.js 14 App Router, TypeScript strict mode
- **Hosting**: Cloudflare Pages (`@cloudflare/next-on-pages`)
- **Database**: Supabase (PostgreSQL)
- **Auth**: JWT in httpOnly cookie (`mk_token`), signed with `jose`
- **Styling**: Tailwind CSS v3

---

## Quick Start

### 1. Clone & install
```bash
npm install
```

### 2. Set up Supabase
1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor → run `database/schema.sql`
3. Copy your project URL and service role key

### 3. Configure environment
```bash
cp .env.example .env.local
# Edit .env.local with your values
```

### 4. Run locally
```bash
npm run dev
# Visit http://localhost:3000
# Login with ADMIN_EMAIL / ADMIN_PASSWORD from .env.local
```

### 5. Deploy to Cloudflare Pages
```bash
# Install wrangler
npm install -g wrangler
wrangler login

# Create KV namespace for metrics cache
wrangler kv:namespace create METRICS_CACHE
# Copy the ID into wrangler.toml

# Build and deploy
npm run deploy
```

---

## Roles & Routing

| Role | Login redirects to | Can access |
|------|-------------------|------------|
| Admin | `/admin` | Everything |
| Client | `/dashboard` or `/onboarding` | `/dashboard`, `/payouts`, `/onboarding` |
| Agency | `/agency` | `/agency`, `/agency/clients/:id`, `/agency/payouts` |

---

## Key Features

### Redirect + Click Tracking
Every influencer, publication, and affiliate gets a unique slug at `/r/[slug]`.
- **Dedup**: cookie-based (30-min window per browser per slug)
- **Geo**: Cloudflare edge headers (`cf-ipcountry`, `cf-ipcity`)
- **Attribution cookies**: `mk_slug` (last-touch, 30d), `mk_slug_first` (first-touch, 90d)

### Sale Attribution Priority
1. Discount code → influencer
2. Discount code → affiliate (per_sale only)
3. `mk_slug` cookie → influencer
4. `mk_slug` cookie → affiliate (per_sale, within attribution window)
5. `mk_slug` cookie → publication

### Webhook Endpoints
- `POST /api/webhook/shopify` — verified via HMAC
- `POST /api/webhook/razorpay?clientId=X` — verified via secret header
- `POST /api/webhook/generic?clientId=X` — `orderId` required

### Ambassador System
Public affiliate signup at `/affiliate/join/[clientSlug]`.
Brands can pause/resume ambassadors from the Affiliates → Ambassadors tab.

---

## Checkout Snippets

### Shopify (Order Status Page)
```html
<script>
(function() {
  function getCookie(name) {
    return document.cookie.split('; ').find(r => r.startsWith(name + '='))?.split('=')[1] || '';
  }
  var slug = getCookie('mk_slug');
  var first = getCookie('mk_slug_first');
  if (slug) {
    fetch('/cart/update.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({attributes: {mk_slug: slug, mk_slug_first: first}})
    });
  }
})();
</script>
```

### Razorpay
```javascript
var options = {
  // ...
  notes: {
    mk_slug: getCookie('mk_slug'),
    mk_slug_first: getCookie('mk_slug_first'),
  }
};
```

---

## Plan Limits

| Plan | Price | Influencers | Affiliates | Publications | Campaigns |
|------|-------|-------------|------------|--------------|-----------|
| Basic | ₹4,249/mo | 5 | 5 | 5 | 3 |
| Pro | ₹4,549/mo | Unlimited | Unlimited | Unlimited | Unlimited |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Service role key (server-side only) |
| `JWT_SECRET` | ✓ | Min 32 chars for JWT signing |
| `ADMIN_EMAIL` | ✓ | Admin login email |
| `ADMIN_PASSWORD` | ✓ | Admin login password |
| `NEXT_PUBLIC_BASE_URL` | ✓ | App URL (e.g. https://app.korant.in) |
| `BASE_URL` | ✓ | Same as above (server-side) |
| `GOOGLE_CLIENT_ID` | Optional | For Search Console OAuth |
| `GOOGLE_CLIENT_SECRET` | Optional | For Search Console OAuth |
