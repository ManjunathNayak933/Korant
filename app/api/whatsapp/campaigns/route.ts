import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { estimateCost } from '@/lib/whatsapp'
import { generateSlug, ensureUniqueSlug } from '@/lib/tracking'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('whatsapp_campaigns')
    .select('*')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')!
  const body = await request.json()
  const { name, template_id, template_name, language = 'en', list_name, variable_map = {}, campaign_id, scheduled_at } = body

  if (!name || !template_name || !list_name) {
    return NextResponse.json({ error: 'name, template_name, list_name required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // Count contacts in list
  const { count } = await sb
    .from('whatsapp_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', userId)
    .eq('list_name', list_name)
    .eq('opted_in', true)

  const totalContacts = count || 0
  const { inr } = estimateCost(totalContacts)

  // Generate tracking slug for this campaign
  const slugBase = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20)
  const tracking_slug = await ensureUniqueSlug(`wa-${slugBase}`)

  // Get destination URL from client's store or use a default
  const { data: client } = await sb.from('clients').select('custom_domain').eq('id', userId).single()
  const destUrl = client?.custom_domain ? `https://${client.custom_domain}` : 'https://yourstore.com'

  // Insert redirect slug into influencers table (reuse existing tracking infra)
  // Actually insert as a special tracking record
  const { data: campaign, error } = await sb
    .from('whatsapp_campaigns')
    .insert({
      client_id: userId,
      campaign_id: campaign_id || null,
      name,
      template_id: template_id || null,
      template_name,
      tracking_slug,
      variable_map,
      list_name,
      total_contacts: totalContacts,
      estimated_cost: inr,
      status: scheduled_at ? 'scheduled' : 'draft',
      scheduled_at: scheduled_at || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const trackingLink = `${process.env.NEXT_PUBLIC_BASE_URL}/r/${tracking_slug}`
  return NextResponse.json({ ...campaign, tracking_link: trackingLink, estimated_cost_inr: inr }, { status: 201 })
}
