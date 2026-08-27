-- RINKO DELIVERY — SUPABASE SAAS ADMIN SCHEMA
-- Run this whole file once in Supabase → SQL Editor. It is safe to re-run:
-- every statement either uses "if not exists" or drops/recreates policies.

-- ============================================================
-- PART 1 — Pricing settings & coupons (original)
-- ============================================================

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

-- ============================================================
-- PART 2 — Profiles (who is admin, who is contractor)
-- ============================================================
-- One row per Supabase Auth user. Create the auth user first
-- (Supabase Dashboard → Authentication → Users → Add user), then this
-- trigger automatically creates a matching profile row with role
-- 'contractor'. Promote your own account to 'admin' once, manually,
-- after your first login (see the setup guide).

create table if not exists public.rinko_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'contractor' check (role in ('admin', 'contractor')),
  full_name text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.rinko_profiles enable row level security;

create or replace function public.rinko_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rinko_profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists rinko_on_auth_user_created on auth.users;
create trigger rinko_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.rinko_handle_new_user();

-- ============================================================
-- PART 3 — Orders (the real, shared order database)
-- ============================================================
-- Written only by the Netlify Functions (service role key, bypasses
-- RLS) after the price is re-verified server-side — never written
-- directly from the browser. Read/updated from the browser only
-- through a logged-in admin or contractor session, per the policies
-- below.

create table if not exists public.rinko_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  company text,
  pickup_address text not null,
  dropoff_address text not null,
  distance_miles numeric,
  preferred_time text,
  item_size text not null,
  package_type text,
  estimated_weight text,
  delivery_speed text not null,
  promo_code text,
  pricing_breakdown jsonb,
  total numeric not null,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'failed', 'refunded')),
  order_status text not null default 'pending' check (order_status in ('pending', 'assigned', 'picked_up', 'delivered', 'cancelled')),
  assigned_contractor uuid references public.rinko_profiles (id) on delete set null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rinko_orders enable row level security;

create or replace function public.rinko_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rinko_orders_set_updated_at on public.rinko_orders;
create trigger rinko_orders_set_updated_at
  before update on public.rinko_orders
  for each row execute procedure public.rinko_set_updated_at();

-- ============================================================
-- PART 3b — Admin-check helper (avoids RLS self-recursion)
-- ============================================================
-- A policy on rinko_profiles that queries rinko_profiles again (to check
-- "is this user an admin?") causes Postgres to report "infinite recursion
-- detected in policy for relation rinko_profiles" — it errors out during
-- planning rather than proving the subquery terminates. The fix is a
-- SECURITY DEFINER function: it runs as the function's owner (the table
-- owner), which bypasses RLS on the inner query, so the outer policy's
-- check no longer re-triggers itself.

create or replace function public.rinko_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.rinko_profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

-- ============================================================
-- PART 4 — Policies (drop + recreate so this file is re-runnable)
-- ============================================================

drop policy if exists "Public can read settings" on public.rinko_settings;
drop policy if exists "Admin can read settings" on public.rinko_settings;
drop policy if exists "Admin can update settings" on public.rinko_settings;
drop policy if exists "Public can read active coupons" on public.rinko_coupons;
drop policy if exists "Admin can manage coupons" on public.rinko_coupons;
drop policy if exists "Users can read own profile" on public.rinko_profiles;
drop policy if exists "Admins can read all profiles" on public.rinko_profiles;
drop policy if exists "Admins can manage contractor profiles" on public.rinko_profiles;
drop policy if exists "Admins can read all orders" on public.rinko_orders;
drop policy if exists "Admins can update all orders" on public.rinko_orders;
drop policy if exists "Contractors can read assigned orders" on public.rinko_orders;
drop policy if exists "Contractors can update assigned orders" on public.rinko_orders;

-- Pricing is public (the quote calculator on the website reads it
-- without logging in); only an admin account can change it.
create policy "Public can read settings"
on public.rinko_settings for select
using (true);

create policy "Admin can update settings"
on public.rinko_settings for update
using (public.rinko_is_admin())
with check (public.rinko_is_admin());

create policy "Public can read active coupons"
on public.rinko_coupons for select
using (active = true);

create policy "Admin can manage coupons"
on public.rinko_coupons for all
using (public.rinko_is_admin())
with check (public.rinko_is_admin());

-- Profiles: everyone can read their own row (needed so the admin/
-- contractor dashboards can tell which screen to show); only an
-- admin can read or edit every profile (e.g. to see the contractor
-- list when assigning an order).
create policy "Users can read own profile"
on public.rinko_profiles for select
using (auth.uid() = id);

create policy "Admins can read all profiles"
on public.rinko_profiles for select
using (public.rinko_is_admin());

create policy "Admins can manage contractor profiles"
on public.rinko_profiles for update
using (public.rinko_is_admin())
with check (public.rinko_is_admin());

-- Orders: no public policy at all — the Netlify Functions write and
-- read using the service role key, which ignores RLS entirely. From
-- the browser, an admin sees/edits everything; a contractor sees/
-- edits only the orders assigned to them.
create policy "Admins can read all orders"
on public.rinko_orders for select
using (public.rinko_is_admin());

create policy "Admins can update all orders"
on public.rinko_orders for update
using (public.rinko_is_admin())
with check (public.rinko_is_admin());

create policy "Contractors can read assigned orders"
on public.rinko_orders for select
using (assigned_contractor = auth.uid());

create policy "Contractors can update assigned orders"
on public.rinko_orders for update
using (assigned_contractor = auth.uid())
with check (assigned_contractor = auth.uid());

-- ============================================================
-- PART 5 — Customer tracking link + proof-of-delivery photo
-- ============================================================
-- Adds a random, unguessable token per order (separate from the
-- sequential order_code) and a place to store the delivery photo URL.
-- Customers never get a Supabase login — they access their own order
-- only through this token, via the rinko_track_order() function below,
-- which returns just a handful of safe columns and nothing if the
-- token doesn't match. This avoids opening a public RLS policy on
-- rinko_orders (which would expose every customer's name/address to
-- anyone who could enumerate rows).

alter table public.rinko_orders
  add column if not exists tracking_token text unique
  default replace(gen_random_uuid()::text, '-', '');

alter table public.rinko_orders
  add column if not exists proof_photo_url text;

update public.rinko_orders
set tracking_token = replace(gen_random_uuid()::text, '-', '')
where tracking_token is null;

create or replace function public.rinko_track_order(p_token text)
returns table (
  order_code text,
  order_status text,
  payment_status text,
  pickup_address text,
  dropoff_address text,
  item_size text,
  delivery_speed text,
  proof_photo_url text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select order_code, order_status, payment_status, pickup_address, dropoff_address,
         item_size, delivery_speed, proof_photo_url, created_at, updated_at
  from public.rinko_orders
  where tracking_token = p_token
  limit 1;
$$;

grant execute on function public.rinko_track_order(text) to anon, authenticated;

-- Storage bucket for delivery-proof photos taken by contractors.
-- Public bucket: anyone with the exact file URL can view it (fine —
-- it's just a photo of a package at a doorstep, and the URL is only
-- ever shared via the tracking link / admin dashboard). Only logged-in
-- accounts (admin or contractor — the only auth.users in this app) can
-- upload.
insert into storage.buckets (id, name, public)
values ('delivery-proofs', 'delivery-proofs', true)
on conflict (id) do nothing;

drop policy if exists "Contractors can upload delivery proofs" on storage.objects;
create policy "Contractors can upload delivery proofs"
on storage.objects for insert
to authenticated
with check (bucket_id = 'delivery-proofs');

drop policy if exists "Public can view delivery proofs" on storage.objects;
create policy "Public can view delivery proofs"
on storage.objects for select
using (bucket_id = 'delivery-proofs');
