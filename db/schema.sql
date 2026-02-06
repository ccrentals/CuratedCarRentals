-- Curated Car Rentals schema for Neon Postgres
-- Apply in Neon SQL Editor.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  year int not null,
  daily_rate_cents int not null,
  deposit_cents int not null,
  status text not null default 'ACTIVE',
  features_json jsonb not null default '[]'::jsonb,
  image_urls_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  pickup_location text not null,
  status text not null,
  pricing_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_date_check check (end_date > start_date)
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  provider text not null,
  deposit_amount_cents int not null,
  currency text not null default 'JMD',
  status text not null,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  unique(provider, event_id)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bookings_vehicle_id_idx on bookings(vehicle_id);
create index if not exists bookings_status_idx on bookings(status);
create index if not exists bookings_dates_idx on bookings(start_date, end_date);
create index if not exists payments_booking_id_idx on payments(booking_id);
create index if not exists payments_status_idx on payments(status);
create index if not exists vehicles_status_idx on vehicles(status);
