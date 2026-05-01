export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role')!
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'events'
  const clientId = searchParams.get('clientId') || (role === 'client' ? userId : null)
  const month = searchParams.get('month') || ''

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (role === 'client' && clientId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = getSupabaseAdmin()

  if (type === 'ambassadors') {
    const { data } = await sb
      .from('affiliates')
      .select('name, handle, email, phone, is_active, paused_at, created_at')
      .eq('client_id', clientId)
      .eq('source', 'public_signup')

    const rows = [['Name', 'Handle', 'Email', 'Phone', 'Status', 'Joined', 'Paused At']]
    for (const a of (data || [])) {
      rows.push([a.name, a.handle, a.email || '', a.phone || '', a.is_active ? 'active' : 'paused', a.created_at?.slice(0, 10) || '', a.paused_at?.slice(0, 10) || ''])
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="ambassadors-${month || 'all'}.csv"`,
      },
    })
  }

  if (type === 'payouts') {
    let query = sb.from('payouts').select('*').eq('client_id', clientId)
    if (month) query = query.eq('month', month)
    const { data } = await query

    const rows = [['Entity', 'Handle', 'Type', 'Amount', 'Month', 'Status', 'Paid Via', 'UTR', 'Paid At']]
    for (const p of (data || [])) {
      rows.push([p.entity_name, p.handle || '', p.entity_type, p.amount, p.month, p.status, p.paid_via || '', p.utr_number || '', p.paid_at?.slice(0, 10) || ''])
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="payouts-${month || 'all'}.csv"`,
      },
    })
  }

  return NextResponse.json({ error: 'Unknown export type' }, { status: 400 })
}
