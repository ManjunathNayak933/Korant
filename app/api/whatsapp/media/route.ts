export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getWAConfig, uploadMediaToMeta } from '@/lib/whatsapp'

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const { fileBase64, mimeType, fileName } = body

  if (!fileBase64 || !mimeType || !fileName) {
    return NextResponse.json({ error: 'fileBase64, mimeType, fileName required' }, { status: 400 })
  }

  // Validate mime type
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf']
  if (!allowed.includes(mimeType)) {
    return NextResponse.json({ error: `Unsupported type. Allowed: ${allowed.join(', ')}` }, { status: 400 })
  }

  // Max ~5MB base64 check
  if (fileBase64.length > 7 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 })
  }

  const config = await getWAConfig(userId)
  if (!config) return NextResponse.json({ error: 'WhatsApp not connected' }, { status: 400 })

  const result = await uploadMediaToMeta(config, fileBase64, mimeType, fileName)
  if ('error' in result) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}