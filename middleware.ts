import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon.ico|india-map.png).*)'],
}

// Hard-fail in production if the signing secret is missing. Middleware gates
// every route, so silently using a fallback secret here would be a critical
// auth bypass. (lib/auth.ts has the same guard for the login path.)
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production')
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-in-production-32chars'
)

const PUBLIC_PATHS = [
  '/login',
  '/paused',
  '/affiliate/join',
  '/r/',
  '/api/auth/',
  '/api/webhook/',
  '/api/whatsapp/connect',
  '/api/affiliate-signup/',
  '/api/marketplace/',
  '/api/beacon',
]

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path.startsWith(p))
}

// Defense in depth: clients must never be able to supply their own identity
// headers. We strip any inbound x-user-* on EVERY request (including public
// early-returns) so the only x-user-* a route can ever see is one this
// middleware set from a verified JWT.
function stripIdentityHeaders(req: NextRequest): Headers {
  const h = new Headers(req.headers)
  h.delete('x-user-id')
  h.delete('x-user-role')
  h.delete('x-user-email')
  return h
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const sanitizedHeaders = stripIdentityHeaders(request)
  const passThrough = () => NextResponse.next({ request: { headers: sanitizedHeaders } })

  // Always pass through Next.js internals
  if (pathname.startsWith('/_next/')) return passThrough()

  // Allow public paths (with identity headers stripped)
  if (isPublic(pathname)) return passThrough()

  // Allow OPTIONS preflight + POST to signup-requests without auth (CORS for app.microkorant.in)
  if (pathname === '/api/signup-requests' || pathname.startsWith('/api/signup-requests')) {
    if (request.method === 'OPTIONS' || request.method === 'POST') {
      const origin = request.headers.get('origin') || ''
      const allowed = ['https://app.microkorant.in','https://www.microkorant.in','https://microkorant.in'].includes(origin) ? origin : '*'
      if (request.method === 'OPTIONS') {
        return new NextResponse(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': allowed,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }})
      }
      const res = NextResponse.next({ request: { headers: sanitizedHeaders } })
      res.headers.set('Access-Control-Allow-Origin', allowed)
      return res
    }
  }

  // Get token
  const token = request.cookies.get('mk_token')?.value
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Verify JWT
  let payload: any
  try {
    const { payload: p } = await jwtVerify(token, JWT_SECRET)
    payload = p
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete('mk_token')
    return res
  }

  const role = payload.role as string
  const clientId = payload.sub as string

  // Status check (paused/suspended) is handled by the dashboard page itself
  // Cannot do self-fetch in Cloudflare edge middleware

  // Block /api/admin/* for non-admin
  if (pathname.startsWith('/api/admin/') && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Role-based page routing
  if (!pathname.startsWith('/api/')) {
    if (role === 'admin') {
      if (pathname.startsWith('/dashboard') || pathname.startsWith('/agency')) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
    } else if (role === 'client') {
      if (pathname.startsWith('/admin') || pathname.startsWith('/agency')) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
    } else if (role === 'agency') {
      if (pathname.startsWith('/admin') || pathname.startsWith('/dashboard')) {
        return NextResponse.redirect(new URL('/agency', request.url))
      }
    }
  }

  // Inject user info in headers for API routes (onto the sanitized header set,
  // so any client-supplied x-user-* was already removed above).
  sanitizedHeaders.set('x-user-id', clientId)
  sanitizedHeaders.set('x-user-role', role)
  sanitizedHeaders.set('x-user-email', payload.email || '')

  return NextResponse.next({ request: { headers: sanitizedHeaders } })
}
