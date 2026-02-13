-- Curated Car Rentals schema for Neon Postgres
-- Apply in Neon SQL Editor.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  username text,
  full_name text,
  password_hash text not null,
  must_change_password boolean not null default false,
  temp_password_expires_at timestamptz,
  password_updated_at timestamptz,
  role text not null default 'admin',
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by_user_id uuid references users(id) on delete set null,
  deactivated_reason text,
  last_login_at timestamptz,
  last_login_ip text,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table users
  add column if not exists locked_at timestamptz;

alter table users
  add column if not exists full_name text;

alter table users
  add column if not exists username text;

alter table users
  add column if not exists is_active boolean not null default true;

alter table users
  add column if not exists deactivated_at timestamptz;

alter table users
  add column if not exists deactivated_by_user_id uuid references users(id) on delete set null;

alter table users
  add column if not exists deactivated_reason text;

alter table users
  add column if not exists last_login_at timestamptz;

alter table users
  add column if not exists last_login_ip text;

alter table users
  add column if not exists must_change_password boolean not null default false;

alter table users
  add column if not exists temp_password_expires_at timestamptz;

alter table users
  add column if not exists password_updated_at timestamptz;

create table if not exists admin_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text,
  ip text,
  success boolean not null default false,
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
  address text,
  notes text,
  last_booked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table customers
  add column if not exists address text;

alter table customers
  add column if not exists notes text;

alter table customers
  add column if not exists last_booked_at timestamptz;

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  pickup_location text not null,
  status text not null,
  pricing_json jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  archived_by_user_id uuid references users(id) on delete set null,
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_date_check check (end_date > start_date)
);

alter table bookings
  add column if not exists archived_at timestamptz;

alter table bookings
  add column if not exists archived_by_user_id uuid references users(id) on delete set null;

alter table bookings
  add column if not exists archived_reason text;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  provider text not null,
  deposit_amount_cents int not null,
  currency text not null default 'JMD',
  status text not null,
  provider_ref text,
  provider_transaction_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  deleted_by_user_id uuid references users(id) on delete set null,
  deleted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table payments
  add column if not exists deleted_at timestamptz;

alter table payments
  add column if not exists deleted_by_user_id uuid references users(id) on delete set null;

alter table payments
  add column if not exists deleted_reason text;

create table if not exists blockouts (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_documents (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  content text not null default '',
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  is_active boolean not null default true,
  discount_type text not null,
  discount_value numeric(10, 2) not null,
  min_subtotal_cents int,
  max_redemptions int,
  max_redemptions_per_customer int,
  start_at timestamptz,
  end_at timestamptz,
  allowed_vehicle_ids_json jsonb not null default '[]'::jsonb,
  excluded_vehicle_ids_json jsonb not null default '[]'::jsonb,
  blackout_dates_json jsonb not null default '[]'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_discount_type_check check (discount_type in ('PERCENT', 'FIXED'))
);

create unique index if not exists promo_codes_code_lower_unique on promo_codes (lower(code));

create table if not exists promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  customer_email text,
  discount_amount_cents int not null,
  created_at timestamptz not null default now(),
  unique (promo_code_id, booking_id)
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

create table if not exists user_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bookings_vehicle_id_idx on bookings(vehicle_id);
create index if not exists bookings_status_idx on bookings(status);
create index if not exists bookings_dates_idx on bookings(start_date, end_date);
create index if not exists bookings_archived_at_idx on bookings(archived_at);
create index if not exists customers_email_lower_idx on customers (lower(email));
create index if not exists customers_phone_idx on customers(phone);
create index if not exists customers_last_booked_at_idx on customers(last_booked_at);
create index if not exists payments_booking_id_idx on payments(booking_id);
create index if not exists payments_status_idx on payments(status);
create index if not exists payments_deleted_at_idx on payments(deleted_at);
create index if not exists users_email_idx on users(email);
create index if not exists users_username_idx on users(username);
create unique index if not exists users_username_lower_unique on users ((lower(username))) where username is not null;
create index if not exists users_role_idx on users(role);
create index if not exists users_is_active_idx on users(is_active);
create index if not exists user_invites_user_id_idx on user_invites(user_id);
create index if not exists user_invites_expires_at_idx on user_invites(expires_at);
create index if not exists vehicles_status_idx on vehicles(status);
create index if not exists admin_login_attempts_email_idx on admin_login_attempts(email);
create index if not exists admin_login_attempts_ip_idx on admin_login_attempts(ip);
create index if not exists admin_login_attempts_created_idx on admin_login_attempts(created_at);
create index if not exists blockouts_vehicle_id_idx on blockouts(vehicle_id);
create index if not exists blockouts_range_idx on blockouts(start_at, end_at);
create index if not exists admin_documents_key_idx on admin_documents(key);
create index if not exists promo_codes_active_idx on promo_codes(is_active);
create index if not exists promo_codes_start_idx on promo_codes(start_at);
create index if not exists promo_codes_end_idx on promo_codes(end_at);
create index if not exists promo_redemptions_promo_code_id_idx on promo_redemptions(promo_code_id);
create index if not exists promo_redemptions_booking_id_idx on promo_redemptions(booking_id);
create index if not exists promo_redemptions_customer_id_idx on promo_redemptions(customer_id);
create index if not exists promo_redemptions_customer_email_lower_idx on promo_redemptions (lower(customer_email));
