-- MicroKorant SaaS Platform — Supabase Schema
-- Run this in your Supabase SQL editor

-- Clients
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  client_type text default 'saas',
  managed_by text default 'MicroKorant',
  custom_domain text,
  affiliate_slug text unique,
  webhook_secret text,
  shopify_domain text,
  shopify_token text,
  plan text default 'basic',
  status text default 'active',
  status_note text,
  plan_activated_at timestamptz,
  next_billing_at timestamptz,
  onboarding jsonb default '{}',
  goals jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Agencies
create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  phone text,
  website text,
  services text[] default '{}',
  status text default 'active',
  status_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Agency handlers
create table if not exists agency_handlers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  agency_id text not null,
  service text not null,
  agency_name text,
  request_id uuid,
  accepted_at timestamptz,
  created_at timestamptz default now(),
  unique(client_id, agency_id, service)
);

-- Agency requests
create table if not exists agency_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id text not null,
  agency_name text not null,
  client_id uuid references clients(id),
  client_email text not null,
  client_name text not null,
  services text[] not null,
  status text default 'pending',
  message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Signup requests
create table if not exists signup_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  full_name text not null,
  brand_name text not null,
  email text unique not null,
  phone text not null,
  password_hash text not null,
  plan text,
  services text[],
  note text,
  status text default 'pending',
  rejected_reason text,
  created_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Campaigns
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  description text default '',
  is_active boolean default true,
  is_protected boolean default false,
  created_by text default 'admin',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(client_id, name)
);

-- Influencers
create table if not exists influencers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  name text not null,
  handle text not null,
  social_platform text default 'instagram',
  social_url text not null,
  fee numeric default 0,
  destination_url text not null,
  redirect_slug text unique not null,
  discount_code text,
  shopify_price_rule_id bigint,
  is_active boolean default true,
  created_by text default 'admin',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(discount_code, client_id)
);

-- Publications
create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  publication_name text not null,
  author_name text,
  type text default 'article',
  article_url text,
  redirect_slug text unique not null,
  destination_url text not null,
  estimated_reach integer,
  is_sponsored boolean default false,
  published_at date,
  cost numeric default 0,
  is_active boolean default true,
  created_by text default 'admin',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Affiliate programs
create table if not exists affiliate_programs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  description text default '',
  commission_type text default 'percentage',
  commission_value numeric not null,
  commission_trigger text default 'per_sale',
  attribution_window_days integer default 30,
  is_public boolean default false,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Affiliates
create table if not exists affiliates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  program_id uuid references affiliate_programs(id) on delete set null,
  source text default 'manual',
  name text not null,
  handle text not null,
  email text,
  phone text,
  redirect_slug text unique not null,
  destination_url text not null,
  discount_code text,
  commission_type text default 'percentage',
  commission_value numeric not null,
  commission_trigger text default 'per_sale',
  attribution_window_days integer default 30,
  is_active boolean default true,
  paused_at timestamptz,
  paused_reason text,
  created_by text default 'admin',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(email, program_id)
);

-- Events
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid references influencers(id) on delete set null,
  publication_id uuid references publications(id) on delete set null,
  affiliate_id uuid references affiliates(id) on delete set null,
  client_id uuid references clients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  type text not null,
  attribution_method text not null,
  city text,
  country text,
  lat double precision,
  lon double precision,
  device text,
  browser text,
  referrer text,
  ip text,
  first_touch_slug text,
  order_value numeric default 0,
  discount_code text,
  commission_amount numeric default 0,
  platform text,
  order_id text,
  timestamp timestamptz default now()
);

-- Events dedup indexes
create unique index if not exists events_order_influencer_idx
  on events(order_id, influencer_id)
  where order_id is not null and influencer_id is not null;

create unique index if not exists events_order_affiliate_idx
  on events(order_id, affiliate_id)
  where order_id is not null and affiliate_id is not null;

create unique index if not exists events_order_publication_idx
  on events(order_id, publication_id)
  where order_id is not null and publication_id is not null;

-- Performance indexes
create index if not exists events_client_id_idx on events(client_id);
create index if not exists events_timestamp_idx on events(timestamp desc);
create index if not exists events_type_idx on events(type);
create index if not exists influencers_redirect_slug_idx on influencers(redirect_slug);
create index if not exists affiliates_redirect_slug_idx on affiliates(redirect_slug);
create index if not exists publications_redirect_slug_idx on publications(redirect_slug);

-- Payouts
create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  entity_name text not null,
  handle text,
  amount numeric not null,
  month text not null,
  status text default 'pending',
  source text not null,
  paid_at timestamptz,
  paid_via text,
  paid_by text,
  utr_number text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(client_id, entity_id, month)
);

-- GSC connections
create table if not exists gsc_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique references clients(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  property_url text not null,
  property_type text default 'url_prefix',
  connected_at timestamptz default now(),
  last_verified_at timestamptz,
  verified_ok boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security (disable for service role, enable for anon if needed)
-- alter table clients enable row level security;
-- Note: We use service role key server-side, so RLS is optional.
-- Enable only if you expose Supabase directly to clients (not recommended).

-- ─────────────────────────────────────────
-- WhatsApp module
-- ─────────────────────────────────────────

-- Per-client WhatsApp Business API credentials
create table if not exists whatsapp_configs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique references clients(id) on delete cascade,
  phone_number_id text not null,
  waba_id text,
  access_token text not null,
  phone_display text,
  verified boolean default false,
  monthly_conversations_used integer default 0,
  month_reset_at date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Templates synced from Meta (or submitted via MicroKorant)
create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  template_name text not null,
  category text default 'MARKETING',
  language text default 'en',
  status text default 'PENDING',
  header_text text,
  body_text text not null,
  footer_text text,
  has_buttons boolean default false,
  button_config jsonb,
  variable_count integer default 0,
  meta_template_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(client_id, template_name, language)
);

-- Contact lists
create table if not exists whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  list_name text not null,
  phone text not null,
  name text,
  custom_vars jsonb default '{}',
  opted_in boolean default true,
  opted_out_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists wa_contacts_client_idx on whatsapp_contacts(client_id);

-- Campaigns
create table if not exists whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  name text not null,
  template_id uuid references whatsapp_templates(id),
  template_name text not null,
  tracking_slug text,
  variable_map jsonb default '{}',
  list_name text,
  total_contacts integer default 0,
  sent integer default 0,
  delivered integer default 0,
  read integer default 0,
  clicked integer default 0,
  sales integer default 0,
  revenue numeric default 0,
  status text default 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  estimated_cost numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Per-message tracking
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references whatsapp_campaigns(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  wa_message_id text unique,
  phone text not null,
  contact_name text,
  status text default 'sent',
  delivered_at timestamptz,
  read_at timestamptz,
  clicked_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz default now()
);
create index if not exists wa_messages_campaign_idx on whatsapp_messages(campaign_id);
create index if not exists wa_messages_wa_id_idx on whatsapp_messages(wa_message_id);
