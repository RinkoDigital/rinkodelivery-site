-- RINKO DELIVERY — SUPABASE SAAS ADMIN SCHEMA

create table if not exists public.rinko_settings (
  id text primary key default 'main',
  small_base numeric not null default 5,
  medium_base numeric not null default 8,
  large_base numeric not null default 12,
  per_mile numeric not null default 2.10,
  express_fee numeric not null default 15,
  heavy_fee numeric not null default 15,
  senior_internal_code text not null default 'SENIORHEAVY',
  minimum_price numeric not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.rinko_settings (id)
values ('main')
on conflict (id) do nothing;

create table if not exists public.rinko_coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_percent numeric not null check (discount_percent >= 0 and discount_percent <= 100),
  expires_at timestamptz,
  usage_limit integer,
  used_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.rinko_settings enable row level security;
alter table public.rinko_coupons enable row level security;

drop policy if exists "Admin can read settings" on public.rinko_settings;
drop policy if exists "Admin can update settings" on public.rinko_settings;
drop policy if exists "Public can read settings" on public.rinko_settings;
drop policy if exists "Admin can manage coupons" on public.rinko_coupons;
drop policy if exists "Public can read active coupons" on public.rinko_coupons;

create policy "Public can read settings"
on public.rinko_settings
for select
using (true);

create policy "Admin can update settings"
on public.rinko_settings
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "Public can read active coupons"
on public.rinko_coupons
for select
using (active = true);

create policy "Admin can manage coupons"
on public.rinko_coupons
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
