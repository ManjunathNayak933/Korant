export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getAudienceOverlap } from '@/lib/influencer-center'

// [id] here is handle_platform encoded as base64 to avoid URL issues
// e.g. btoa('fitrahul|instagram') = 'Zml0cmFodWx8aW5zdGFncmFt'
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role   = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!

  if (role !== 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  let handle: string, platform: string
  try {
    const decoded = atob(id)
    const parts = decoded.split('|')
    handle = parts[0]
    platform = parts[1]
    if (!handle || !platform) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const overlaps = await getAudienceOverlap(handle, platform, userId)
  return NextResponse.json({ overlaps })
}
