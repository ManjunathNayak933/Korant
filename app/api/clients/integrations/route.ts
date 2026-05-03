export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('clients')
    .select('shopify_domain, shopify_token, razorpay_key_id, razorpay_key_secret')
    .eq('id', userId)
    .single()

  return NextResponse.json({
    shopify: !!(data?.shopify_domain && data?.shopify_token),
    razorpay: !!(data?.razorpay_key_id && data?.razorpay_key_secret),
  })
}
