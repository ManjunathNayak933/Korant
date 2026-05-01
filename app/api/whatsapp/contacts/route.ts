import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const listName = searchParams.get('list') || ''

  const sb = getSupabaseAdmin()
  let query = sb
    .from('whatsapp_contacts')
    .select('id, list_name, phone, name, opted_in, created_at')
    .eq('client_id', userId)
    .eq('opted_in', true)
    .order('created_at', { ascending: false })
    .limit(500)

  if (listName) query = query.eq('list_name', listName)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also return distinct list names
  const { data: lists } = await sb
    .from('whatsapp_contacts')
    .select('list_name')
    .eq('client_id', userId)
    .eq('opted_in', true)

  const uniqueLists = [...new Set((lists || []).map(l => l.list_name))]
  return NextResponse.json({ contacts: data, lists: uniqueLists, total: data?.length || 0 })
}

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const { list_name, contacts, opted_in_confirmed } = body

  if (!list_name) return NextResponse.json({ error: 'list_name required' }, { status: 400 })
  if (!contacts?.length) return NextResponse.json({ error: 'contacts array required' }, { status: 400 })
  if (!opted_in_confirmed) {
    return NextResponse.json({ error: 'You must confirm all contacts have opted in to receive WhatsApp messages.' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // Validate + normalize phones
  const rows = contacts.map((c: any) => {
    let phone = String(c.phone || c.Phone || '').replace(/\D/g, '')
    if (phone.length === 10) phone = `91${phone}` // India default
    return {
      client_id: userId,
      list_name,
      phone,
      name: c.name || c.Name || null,
      custom_vars: c.custom_vars || {},
      opted_in: true,
    }
  }).filter((r: any) => r.phone.length >= 10)

  if (!rows.length) return NextResponse.json({ error: 'No valid phone numbers found' }, { status: 400 })

  // Upsert — avoid duplicates within same list
  const { data, error } = await sb
    .from('whatsapp_contacts')
    .upsert(rows, { onConflict: 'client_id,list_name,phone', ignoreDuplicates: true })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ added: rows.length, duplicates_skipped: rows.length - (data?.length || 0) }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')
  const listName = searchParams.get('list')

  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  const sb = getSupabaseAdmin()
  let q = sb.from('whatsapp_contacts').update({ opted_in: false, opted_out_at: new Date().toISOString() }).eq('client_id', userId).eq('phone', phone)
  if (listName) q = q.eq('list_name', listName)
  await q
  return NextResponse.json({ ok: true })
}
