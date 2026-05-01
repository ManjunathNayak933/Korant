import { createClient } from '@supabase/supabase-js'

// Use placeholders during build time — real values come from Cloudflare env at runtime
// This prevents "supabaseUrl is required" crash during next build
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type UserRole = 'admin' | 'client' | 'agency'

export interface JWTPayload {
  sub: string
  role: UserRole
  email: string
  name?: string
  iat?: number
  exp?: number
}
