-- ============================================================================
-- AutoFillForm Studio — Supabase PostgreSQL Schema (Free Tier 0đ, 24/7)
-- Chạy toàn bộ file này trong Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null default 'default',
  form_data jsonb not null,
  mode_label text not null default 'Chuẩn',
  status text not null default 'active', -- active | stopped | completed
  total integer not null default 0,
  current_idx integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  estimated_end text not null default '',
  next_run_at text not null default '',
  skip_wait boolean not null default false,
  logs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_items (
  id bigserial primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  seq_index integer not null,
  answers jsonb not null,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending', -- pending | sent
  attempts integer not null default 0,
  last_error text not null default ''
);

create index if not exists idx_campaign_items_due
  on public.campaign_items (campaign_id, status, scheduled_at, seq_index);

create table if not exists public.saved_forms (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null default 'default',
  form_url text not null,
  platform text not null default 'google',
  title text not null,
  description text not null default '',
  form_data jsonb not null,
  config_payload jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_name, form_url)
);

-- Enable RLS & allow service_role full access (Worker uses SUPABASE_SERVICE_ROLE_KEY)
alter table public.campaigns enable row level security;
alter table public.campaign_items enable row level security;
alter table public.saved_forms enable row level security;
