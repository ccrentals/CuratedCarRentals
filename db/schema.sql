-- Curated Car Rentals schema for Neon Postgres
-- Apply in Neon SQL Editor.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  email text unique not null,
  clerk_user_id text unique,
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
  add column if not exists public_id text;

alter table users
  add column if not exists clerk_user_id text;

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
  public_id text not null,
  make text not null,
  model text not null,
  year int not null,
  seat_count int,
  daily_rate_cents int not null,
  deposit_cents int not null,
  status text not null default 'ACTIVE',
  features_json jsonb not null default '[]'::jsonb,
  image_urls_json jsonb not null default '[]'::jsonb,
  deleted_at timestamptz,
  constraint vehicles_seat_count_range check (
    seat_count is null or (seat_count >= 1 and seat_count <= 60)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vehicles
  add column if not exists seat_count int;

alter table vehicles
  add column if not exists public_id text;

alter table vehicles
  add column if not exists deleted_at timestamptz;

alter table vehicles
  drop constraint if exists vehicles_seat_count_range;

alter table vehicles
  add constraint vehicles_seat_count_range check (
    seat_count is null or (seat_count >= 1 and seat_count <= 60)
  );

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  is_blocked boolean not null default false,
  blocked_at timestamptz,
  blocked_by_user_id uuid references users(id) on delete set null,
  blocked_reason text,
  legal_id_type text,
  legal_id_number text,
  legal_id_image_url text,
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

alter table customers
  add column if not exists legal_id_type text;

alter table customers
  add column if not exists legal_id_number text;

alter table customers
  add column if not exists legal_id_image_url text;

alter table customers
  add column if not exists is_blocked boolean not null default false;

alter table customers
  add column if not exists blocked_at timestamptz;

alter table customers
  add column if not exists blocked_by_user_id uuid references users(id) on delete set null;

alter table customers
  add column if not exists blocked_reason text;

alter table customers
  add column if not exists public_id text;

create sequence if not exists users_public_id_seq start 1;
create sequence if not exists customers_public_id_seq start 1;
create sequence if not exists vehicles_public_id_seq start 1;
create sequence if not exists bookings_public_id_seq start 1;
create sequence if not exists quotes_public_id_seq start 1;
create sequence if not exists invoice_number_seq start 1;
create sequence if not exists payments_public_id_seq start 1;
create sequence if not exists promo_codes_public_id_seq start 1;
create sequence if not exists vehicle_maintenance_records_public_id_seq start 1;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_users_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('UR', nextval('users_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_customers_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('CU', nextval('customers_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_bookings_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('BK', nextval('bookings_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_vehicles_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('VE', nextval('vehicles_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_quotes_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('QU', nextval('quotes_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_payments_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('PA', nextval('payments_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_promo_codes_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('PR', nextval('promo_codes_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_vehicle_maintenance_records_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('ME', nextval('vehicle_maintenance_records_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'users_assign_public_id'
      and tgrelid = 'users'::regclass
      and not tgisinternal
  ) then
    create trigger users_assign_public_id
      before insert on users
      for each row
      execute function assign_users_public_id();
  end if;
end $$;

with ordered as (
  select u.id,
         row_number() over (order by u.created_at asc, u.id asc) as rn
  from users u
  where u.public_id is null
),
base as (
  select coalesce(max((substring(u.public_id from '^UR([0-9]+)$'))::bigint), 0) as max_n
  from users u
  where u.public_id ~ '^UR[0-9]+$'
)
update users u
set public_id = format_public_id('UR', base.max_n + ordered.rn)
from ordered, base
where u.id = ordered.id;

do $$
declare
  users_max bigint;
begin
  select max((substring(public_id from '^UR([0-9]+)$'))::bigint)
    into users_max
  from users
  where public_id ~ '^UR[0-9]+$';

  if users_max is null then
    perform setval('users_public_id_seq', 1, false);
  else
    perform setval('users_public_id_seq', users_max, true);
  end if;
end $$;

alter table users
  alter column public_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'customers_assign_public_id'
      and tgrelid = 'customers'::regclass
      and not tgisinternal
  ) then
    create trigger customers_assign_public_id
      before insert on customers
      for each row
      execute function assign_customers_public_id();
  end if;
end $$;

with ordered as (
  select c.id,
         row_number() over (order by c.created_at asc, c.id asc) as rn
  from customers c
  where c.public_id is null
),
base as (
  select coalesce(max((substring(c.public_id from '^CU([0-9]+)$'))::bigint), 0) as max_n
  from customers c
  where c.public_id ~ '^CU[0-9]+$'
)
update customers c
set public_id = format_public_id('CU', base.max_n + ordered.rn)
from ordered, base
where c.id = ordered.id;

do $$
declare
  customers_max bigint;
begin
  select max((substring(public_id from '^CU([0-9]+)$'))::bigint)
    into customers_max
  from customers
  where public_id ~ '^CU[0-9]+$';

  if customers_max is null then
    perform setval('customers_public_id_seq', 1, false);
  else
    perform setval('customers_public_id_seq', customers_max, true);
  end if;
end $$;

alter table customers
  alter column public_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'vehicles_assign_public_id'
      and tgrelid = 'vehicles'::regclass
      and not tgisinternal
  ) then
    create trigger vehicles_assign_public_id
      before insert on vehicles
      for each row
      execute function assign_vehicles_public_id();
  end if;
end $$;

with ordered as (
  select v.id,
         row_number() over (order by v.created_at asc, v.id asc) as rn
  from vehicles v
  where v.public_id is null
),
base as (
  select coalesce(max((substring(v.public_id from '^VE([0-9]+)$'))::bigint), 0) as max_n
  from vehicles v
  where v.public_id ~ '^VE[0-9]+$'
)
update vehicles v
set public_id = format_public_id('VE', base.max_n + ordered.rn)
from ordered, base
where v.id = ordered.id;

do $$
declare
  vehicles_max bigint;
begin
  select max((substring(public_id from '^VE([0-9]+)$'))::bigint)
    into vehicles_max
  from vehicles
  where public_id ~ '^VE[0-9]+$';

  if vehicles_max is null then
    perform setval('vehicles_public_id_seq', 1, false);
  else
    perform setval('vehicles_public_id_seq', vehicles_max, true);
  end if;
end $$;

alter table vehicles
  alter column public_id set not null;

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
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

alter table bookings
  add column if not exists public_id text;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'bookings_assign_public_id'
      and tgrelid = 'bookings'::regclass
      and not tgisinternal
  ) then
    create trigger bookings_assign_public_id
      before insert on bookings
      for each row
      execute function assign_bookings_public_id();
  end if;
end $$;

update bookings
set public_id = 'BK' || substring(public_id from 2)
where public_id ~ '^B[0-9]{6,}$';

with ordered as (
  select b.id,
         row_number() over (order by b.created_at asc, b.id asc) as rn
  from bookings b
  where b.public_id is null
),
base as (
  select coalesce(max((substring(b.public_id from '^BK([0-9]+)$'))::bigint), 0) as max_n
  from bookings b
  where b.public_id ~ '^BK[0-9]+$'
)
update bookings b
set public_id = format_public_id('BK', base.max_n + ordered.rn)
from ordered, base
where b.id = ordered.id;

do $$
declare
  bookings_max bigint;
begin
  select max((substring(public_id from '^BK([0-9]+)$'))::bigint)
    into bookings_max
  from bookings
  where public_id ~ '^BK[0-9]+$';

  if bookings_max is null then
    perform setval('bookings_public_id_seq', 1, false);
  else
    perform setval('bookings_public_id_seq', bookings_max, true);
  end if;
end $$;

alter table bookings
  alter column public_id set not null;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
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
  add column if not exists public_id text;

alter table payments
  add column if not exists deleted_at timestamptz;

alter table payments
  add column if not exists deleted_by_user_id uuid references users(id) on delete set null;

alter table payments
  add column if not exists deleted_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'payments_assign_public_id'
      and tgrelid = 'payments'::regclass
      and not tgisinternal
  ) then
    create trigger payments_assign_public_id
      before insert on payments
      for each row
      execute function assign_payments_public_id();
  end if;
end $$;

with ordered as (
  select p.id,
         row_number() over (order by p.created_at asc, p.id asc) as rn
  from payments p
  where p.public_id is null
),
base as (
  select coalesce(max((substring(p.public_id from '^PA([0-9]+)$'))::bigint), 0) as max_n
  from payments p
  where p.public_id ~ '^PA[0-9]+$'
)
update payments p
set public_id = format_public_id('PA', base.max_n + ordered.rn)
from ordered, base
where p.id = ordered.id;

do $$
declare
  payments_max bigint;
begin
  select max((substring(public_id from '^PA([0-9]+)$'))::bigint)
    into payments_max
  from payments
  where public_id ~ '^PA[0-9]+$';

  if payments_max is null then
    perform setval('payments_public_id_seq', 1, false);
  else
    perform setval('payments_public_id_seq', payments_max, true);
  end if;
end $$;

alter table payments
  alter column public_id set not null;

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
  public_id text not null,
  code text not null,
  is_active boolean not null default true,
  discount_type text not null,
  apply_scope text not null default 'OVERALL_TOTAL',
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
  constraint promo_codes_discount_type_check check (discount_type in ('PERCENT', 'FIXED')),
  constraint promo_codes_apply_scope_check check (apply_scope in ('OVERALL_TOTAL', 'DAYS_TOTAL'))
);

alter table promo_codes
  add column if not exists public_id text;

alter table promo_codes
  add column if not exists apply_scope text default 'OVERALL_TOTAL';

update promo_codes
set apply_scope = 'OVERALL_TOTAL'
where apply_scope is null;

alter table promo_codes
  alter column apply_scope set default 'OVERALL_TOTAL';

alter table promo_codes
  alter column apply_scope set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'promo_codes_apply_scope_check'
      and conrelid = 'promo_codes'::regclass
  ) then
    alter table promo_codes
      add constraint promo_codes_apply_scope_check
      check (apply_scope in ('OVERALL_TOTAL', 'DAYS_TOTAL'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'promo_codes_assign_public_id'
      and tgrelid = 'promo_codes'::regclass
      and not tgisinternal
  ) then
    create trigger promo_codes_assign_public_id
      before insert on promo_codes
      for each row
      execute function assign_promo_codes_public_id();
  end if;
end $$;

with ordered as (
  select p.id,
         row_number() over (order by p.created_at asc, p.id asc) as rn
  from promo_codes p
  where p.public_id is null
),
base as (
  select coalesce(max((substring(p.public_id from '^PR([0-9]+)$'))::bigint), 0) as max_n
  from promo_codes p
  where p.public_id ~ '^PR[0-9]+$'
)
update promo_codes p
set public_id = format_public_id('PR', base.max_n + ordered.rn)
from ordered, base
where p.id = ordered.id;

do $$
declare
  promo_codes_max bigint;
begin
  select max((substring(public_id from '^PR([0-9]+)$'))::bigint)
    into promo_codes_max
  from promo_codes
  where public_id ~ '^PR[0-9]+$';

  if promo_codes_max is null then
    perform setval('promo_codes_public_id_seq', 1, false);
  else
    perform setval('promo_codes_public_id_seq', promo_codes_max, true);
  end if;
end $$;

alter table promo_codes
  alter column public_id set not null;
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

create table if not exists notification_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  dedupe_key text not null,
  channel text not null default 'email',
  provider text,
  provider_message_id text,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_dispatch_log_dedupe_key_unique
  on notification_dispatch_log(dedupe_key);

create index if not exists notification_dispatch_log_entity_idx
  on notification_dispatch_log(entity_type, entity_id);

create index if not exists notification_dispatch_log_event_created_idx
  on notification_dispatch_log(event_type, created_at desc);

create table if not exists booking_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  source text not null default 'PDFMONKEY',
  template_id text,
  provider_document_id text,
  provider_status text,
  download_url text,
  payload_hash text not null,
  generated_at timestamptz not null default now(),
  emailed_at timestamptz,
  last_error text,
  created_by_user_id uuid references users(id) on delete set null
);

create index if not exists booking_invoice_documents_booking_generated_idx
  on booking_invoice_documents(booking_id, generated_at desc);

create unique index if not exists booking_invoice_documents_booking_payload_unique
  on booking_invoice_documents(booking_id, payload_hash);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  message text not null,
  status text not null default 'NEW',
  read_at timestamptz,
  read_by_user_id uuid references users(id) on delete set null,
  source text not null default 'contact_page',
  constraint contact_messages_status_check check (status in ('NEW', 'READ', 'ARCHIVED'))
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
create index if not exists customers_legal_id_number_idx on customers(legal_id_number);
create unique index if not exists customers_public_id_unique_idx on customers(public_id);
create index if not exists payments_booking_id_idx on payments(booking_id);
create index if not exists payments_status_idx on payments(status);
create index if not exists payments_deleted_at_idx on payments(deleted_at);
create unique index if not exists payments_public_id_unique_idx on payments(public_id);
create index if not exists users_email_idx on users(email);
create index if not exists users_username_idx on users(username);
create unique index if not exists users_public_id_unique_idx on users(public_id);
create unique index if not exists users_username_lower_unique on users ((lower(username))) where username is not null;
create unique index if not exists users_clerk_user_id_unique on users (clerk_user_id) where clerk_user_id is not null;
create index if not exists users_role_idx on users(role);
create index if not exists users_is_active_idx on users(is_active);
create index if not exists user_invites_user_id_idx on user_invites(user_id);
create index if not exists user_invites_expires_at_idx on user_invites(expires_at);
create unique index if not exists vehicles_public_id_unique_idx on vehicles(public_id);
create index if not exists vehicles_status_idx on vehicles(status);
create index if not exists vehicles_deleted_at_idx on vehicles(deleted_at);
create index if not exists admin_login_attempts_email_idx on admin_login_attempts(email);
create index if not exists admin_login_attempts_ip_idx on admin_login_attempts(ip);
create index if not exists admin_login_attempts_created_idx on admin_login_attempts(created_at);
create index if not exists blockouts_vehicle_id_idx on blockouts(vehicle_id);
create index if not exists blockouts_range_idx on blockouts(start_at, end_at);
create index if not exists admin_documents_key_idx on admin_documents(key);
create index if not exists promo_codes_active_idx on promo_codes(is_active);
create index if not exists promo_codes_start_idx on promo_codes(start_at);
create index if not exists promo_codes_end_idx on promo_codes(end_at);
create unique index if not exists promo_codes_public_id_unique_idx on promo_codes(public_id);
create index if not exists promo_redemptions_promo_code_id_idx on promo_redemptions(promo_code_id);
create index if not exists promo_redemptions_booking_id_idx on promo_redemptions(booking_id);
create index if not exists promo_redemptions_customer_id_idx on promo_redemptions(customer_id);
create index if not exists promo_redemptions_customer_email_lower_idx on promo_redemptions (lower(customer_email));
create index if not exists contact_messages_status_created_idx on contact_messages(status, created_at desc);
create index if not exists contact_messages_created_idx on contact_messages(created_at desc);
-- Booking revamp foundation (additive / backward-compatible)
create table if not exists booking_locations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  allow_pickup boolean not null default true,
  allow_dropoff boolean not null default true,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_locations_label_check check (char_length(trim(label)) >= 2),
  constraint booking_locations_role_check check (allow_pickup or allow_dropoff)
);

create unique index if not exists booking_locations_label_lower_unique_idx
  on booking_locations(lower(label));
create index if not exists booking_locations_active_sort_idx
  on booking_locations(is_active, sort_order, label);

create table if not exists insurance_plans (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  is_enabled boolean not null default false,
  price_per_day_cents int not null default 0,
  is_global_default boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insurance_plans_price_check check (price_per_day_cents >= 0)
);

create unique index if not exists insurance_plans_vehicle_unique_idx
  on insurance_plans(vehicle_id)
  where vehicle_id is not null;
create unique index if not exists insurance_plans_global_default_unique_idx
  on insurance_plans(is_global_default)
  where is_global_default = true;
create index if not exists insurance_plans_enabled_idx
  on insurance_plans(is_enabled);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'DRAFT',
  expires_at timestamptz,

  customer_full_name text not null,
  customer_email text not null,
  customer_phone text,

  start_at timestamptz not null,
  end_at timestamptz not null,
  pickup_location_id uuid references booking_locations(id) on delete set null,
  dropoff_location_id uuid references booking_locations(id) on delete set null,
  pickup_location_text text not null,
  dropoff_location_text text not null,

  vehicle_id uuid references vehicles(id) on delete set null,
  vehicle_label text not null,
  vehicle_class text,

  pricing_json jsonb not null,
  base_total_cents int not null,
  insurance_total_cents int not null,
  discount_total_cents int not null,
  subtotal_cents int not null,
  total_cents int not null,
  deposit_required_cents int not null,
  amount_due_cents int not null,
  promo_code text,
  insurance_plan_id uuid references insurance_plans(id) on delete set null,
  insurance_enabled boolean not null default false,

  tags text[] not null default '{}'::text[],
  comments text,
  commission_partner_name text,
  client_pays_at_partner boolean not null default false,
  rack_price_cents int,

  created_by_admin_user_id uuid references users(id) on delete set null,
  last_emailed_at timestamptz,
  last_emailed_to text,
  converted_booking_id uuid references bookings(id) on delete set null,

  constraint quotes_status_check check (
    status in ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CONVERTED', 'CANCELLED')
  ),
  constraint quotes_window_check check (end_at > start_at)
);

alter table quotes
  add column if not exists public_id text;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'quotes_assign_public_id'
      and tgrelid = 'quotes'::regclass
      and not tgisinternal
  ) then
    create trigger quotes_assign_public_id
      before insert on quotes
      for each row
      execute function assign_quotes_public_id();
  end if;
end $$;

update quotes
set public_id = 'QU' || substring(public_id from 2)
where public_id ~ '^Q[0-9]{6,}$';

with ordered as (
  select q.id,
         row_number() over (order by q.created_at asc, q.id asc) as rn
  from quotes q
  where q.public_id is null
),
base as (
  select coalesce(max((substring(q.public_id from '^QU([0-9]+)$'))::bigint), 0) as max_n
  from quotes q
  where q.public_id ~ '^QU[0-9]+$'
)
update quotes q
set public_id = format_public_id('QU', base.max_n + ordered.rn)
from ordered, base
where q.id = ordered.id;

do $$
declare
  quotes_max bigint;
begin
  select max((substring(public_id from '^QU([0-9]+)$'))::bigint)
    into quotes_max
  from quotes
  where public_id ~ '^QU[0-9]+$';

  if quotes_max is null then
    perform setval('quotes_public_id_seq', 1, false);
  else
    perform setval('quotes_public_id_seq', quotes_max, true);
  end if;
end $$;

alter table quotes
  alter column public_id set not null;

create table if not exists quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  created_at timestamptz not null default now(),
  event_type text not null,
  actor_admin_user_id uuid references users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  constraint quote_events_event_type_check check (
    event_type in ('CREATED', 'UPDATED', 'EMAILED', 'STATUS_CHANGED', 'CONVERTED', 'PDF_GENERATED')
  )
);

create table if not exists quote_emails (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  to_email text not null,
  subject text not null,
  status text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  constraint quote_emails_status_check check (status in ('SENT', 'FAILED'))
);

create index if not exists quotes_status_created_idx
  on quotes(status, created_at desc);
create index if not exists quotes_start_end_idx
  on quotes(start_at, end_at);
create index if not exists quotes_customer_email_lower_idx
  on quotes(lower(customer_email));
create index if not exists quotes_vehicle_id_idx
  on quotes(vehicle_id);
create unique index if not exists bookings_public_id_unique_idx
  on bookings(public_id);
create unique index if not exists quotes_public_id_unique_idx
  on quotes(public_id);
create index if not exists quote_events_quote_created_idx
  on quote_events(quote_id, created_at desc);
create index if not exists quote_events_event_type_idx
  on quote_events(event_type, created_at desc);
create index if not exists quote_emails_quote_created_idx
  on quote_emails(quote_id, created_at desc);
create index if not exists quote_emails_status_created_idx
  on quote_emails(status, created_at desc);
create index if not exists quote_emails_to_email_lower_idx
  on quote_emails(lower(to_email));

create table if not exists vehicle_profiles (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  vin text,
  license_plate text,
  vehicle_type text,
  vehicle_class text,
  year int,
  color text,
  current_location_label text,
  odometer_value int,
  odometer_unit text not null default 'KM',
  fuel_level_value int,
  available_from date,
  available_until date,
  entry_date date,
  exit_date date,
  needs_cleaning boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_profiles_odometer_non_negative check (odometer_value is null or odometer_value >= 0),
  constraint vehicle_profiles_fuel_level_range check (
    fuel_level_value is null or (fuel_level_value >= 0 and fuel_level_value <= 100)
  )
);

create table if not exists vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  folder text not null default 'Unsorted',
  document_type text not null default 'OTHER',
  title text not null,
  storage_provider text not null default 'UPLOADCARE_FILE_ID',
  storage_key text not null,
  mime_type text,
  size_bytes bigint,
  file_size_bytes int,
  tags jsonb not null default '[]'::jsonb,
  label text,
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint vehicle_documents_size_non_negative check (size_bytes is null or size_bytes >= 0)
);

alter table vehicle_documents
  add column if not exists file_size_bytes int;
alter table vehicle_documents
  add column if not exists label text;
alter table vehicle_documents
  add column if not exists archived_at timestamptz;

update vehicle_documents
set document_type = 'OTHER'
where document_type is null;

alter table vehicle_documents
  alter column document_type set default 'OTHER';
alter table vehicle_documents
  alter column document_type set not null;

update vehicle_documents
set file_size_bytes = least(greatest(size_bytes::bigint, 0), 2147483647)::int
where file_size_bytes is null
  and size_bytes is not null;

alter table vehicle_documents
  drop constraint if exists vehicle_documents_file_size_non_negative;
alter table vehicle_documents
  add constraint vehicle_documents_file_size_non_negative check (
    file_size_bytes is null or file_size_bytes >= 0
  );

create table if not exists vehicle_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label text not null,
  default_folder text not null default 'Unsorted',
  required boolean not null default true,
  allow_not_required boolean not null default true,
  expiry_required boolean not null default false,
  expiry_warning_days int,
  is_active boolean not null default true,
  source text not null default 'SETTINGS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_checklist_templates_key_unique unique (key),
  constraint vehicle_checklist_templates_source_check check (
    source in ('SETTINGS', 'MANUAL')
  ),
  constraint vehicle_checklist_templates_expiry_warning_days_check check (
    expiry_warning_days is null or expiry_warning_days >= 0
  )
);

create table if not exists vehicle_checklist_items (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  template_id uuid references vehicle_checklist_templates(id) on delete set null,
  label text not null,
  folder text not null default 'Unsorted',
  required boolean not null default false,
  allow_not_required boolean not null default true,
  status text not null default 'NOT_OK',
  uploaded_document_id uuid references vehicle_documents(id) on delete set null,
  uploaded_at timestamptz,
  expiration_date date,
  notes text,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint vehicle_checklist_items_status_check check (
    status in ('OK', 'NOT_REQUIRED', 'NOT_OK')
  ),
  constraint vehicle_checklist_items_notes_length_check check (
    notes is null or char_length(notes) <= 4000
  )
);

alter table vehicle_checklist_items
  add column if not exists template_id uuid references vehicle_checklist_templates(id) on delete set null;
alter table vehicle_checklist_items
  add column if not exists status text;
alter table vehicle_checklist_items
  add column if not exists notes text;
alter table vehicle_checklist_items
  add column if not exists allow_not_required boolean not null default true;
alter table vehicle_checklist_items
  add column if not exists uploaded_at timestamptz;
alter table vehicle_checklist_items
  add column if not exists created_by_user_id uuid references users(id) on delete set null;
alter table vehicle_checklist_items
  add column if not exists updated_by_user_id uuid references users(id) on delete set null;
alter table vehicle_checklist_items
  add column if not exists archived_at timestamptz;

update vehicle_checklist_items
set status = case
  when required = false then 'NOT_REQUIRED'
  when uploaded_document_id is not null then 'OK'
  else 'NOT_OK'
end
where status is null or btrim(status) = '';

update vehicle_checklist_items
set uploaded_at = coalesce(uploaded_at, updated_at, created_at, now())
where uploaded_document_id is not null and uploaded_at is null;

alter table vehicle_checklist_items
  alter column status set default 'NOT_OK';
alter table vehicle_checklist_items
  alter column status set not null;
alter table vehicle_checklist_items
  drop constraint if exists vehicle_checklist_items_status_check;
alter table vehicle_checklist_items
  add constraint vehicle_checklist_items_status_check check (
    status in ('OK', 'NOT_REQUIRED', 'NOT_OK')
  );
alter table vehicle_checklist_items
  drop constraint if exists vehicle_checklist_items_notes_length_check;
alter table vehicle_checklist_items
  add constraint vehicle_checklist_items_notes_length_check check (
    notes is null or char_length(notes) <= 4000
  );

create table if not exists vehicle_notes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  note_text text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists vehicle_checklist_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  checklist_item_id uuid not null references vehicle_checklist_items(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vehicle_checklist_events_event_type_check check (
    event_type in (
      'ITEM_CREATED',
      'ITEM_UPDATED',
      'ITEM_DELETED',
      'STATUS_CHANGED',
      'DOCUMENT_LINKED',
      'DOCUMENT_UNLINKED',
      'TEMPLATE_APPLIED'
    )
  )
);

create table if not exists maintenance_service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  default_interval_days int,
  default_interval_odometer int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_service_types_default_interval_days_check check (
    default_interval_days is null or default_interval_days >= 1
  ),
  constraint maintenance_service_types_default_interval_odometer_check check (
    default_interval_odometer is null or default_interval_odometer >= 1
  )
);

create table if not exists vehicle_maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_type_id uuid not null references maintenance_service_types(id) on delete restrict,
  interval_days int,
  interval_odometer int,
  last_service_date date,
  last_service_odometer int,
  next_due_date date,
  next_due_odometer int,
  status text not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_maintenance_schedules_status_check check (
    status in ('ACTIVE', 'PAUSED', 'COMPLETED')
  ),
  constraint vehicle_maintenance_schedules_interval_days_check check (
    interval_days is null or interval_days >= 1
  ),
  constraint vehicle_maintenance_schedules_interval_odometer_check check (
    interval_odometer is null or interval_odometer >= 1
  ),
  constraint vehicle_maintenance_schedules_last_service_odometer_check check (
    last_service_odometer is null or last_service_odometer >= 0
  ),
  constraint vehicle_maintenance_schedules_next_due_odometer_check check (
    next_due_odometer is null or next_due_odometer >= 0
  )
);

create table if not exists vehicle_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_type_id uuid not null references maintenance_service_types(id) on delete restrict,
  service_date date not null,
  service_type text not null default 'General',
  odometer_value int,
  cost_cents int,
  vendor text,
  notes text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vehicle_maintenance_logs_odometer_non_negative check (
    odometer_value is null or odometer_value >= 0
  ),
  constraint vehicle_maintenance_logs_cost_non_negative check (
    cost_cents is null or cost_cents >= 0
  )
);

create table if not exists maintenance_reminders (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  schedule_id uuid not null references vehicle_maintenance_schedules(id) on delete cascade,
  remind_at timestamptz not null,
  status text not null default 'PENDING',
  channel text not null default 'EMAIL',
  created_at timestamptz not null default now(),
  constraint maintenance_reminders_status_check check (
    status in ('PENDING', 'SENT', 'CANCELLED')
  ),
  constraint maintenance_reminders_channel_check check (
    channel in ('EMAIL', 'IN_APP')
  )
);

create table if not exists vehicle_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  status text not null,
  category text not null,
  title text not null,
  description text,
  vendor_name text,
  vendor_contact text,
  reference_number text,
  service_date date,
  scheduled_date date,
  odometer_km int,
  next_due_date date,
  next_due_odometer_km int,
  labor_cost_cents int,
  parts_cost_cents int,
  tax_cost_cents int,
  total_cost_cents int,
  currency text not null default 'JMD',
  priority text not null default 'NORMAL',
  created_by_user_id uuid references users(id) on delete set null,
  completed_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint vehicle_maintenance_records_status_check check (
    status in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  constraint vehicle_maintenance_records_category_check check (
    category in (
      'SERVICE',
      'REPAIR',
      'INSPECTION',
      'REGISTRATION',
      'INSURANCE',
      'TIRE',
      'BRAKE',
      'BATTERY',
      'OTHER'
    )
  ),
  constraint vehicle_maintenance_records_priority_check check (
    priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')
  ),
  constraint vehicle_maintenance_records_currency_check check (
    currency = 'JMD'
  ),
  constraint vehicle_maintenance_records_odometer_non_negative check (
    odometer_km is null or odometer_km >= 0
  ),
  constraint vehicle_maintenance_records_next_due_odometer_non_negative check (
    next_due_odometer_km is null or next_due_odometer_km >= 0
  ),
  constraint vehicle_maintenance_records_labor_non_negative check (
    labor_cost_cents is null or labor_cost_cents >= 0
  ),
  constraint vehicle_maintenance_records_parts_non_negative check (
    parts_cost_cents is null or parts_cost_cents >= 0
  ),
  constraint vehicle_maintenance_records_tax_non_negative check (
    tax_cost_cents is null or tax_cost_cents >= 0
  ),
  constraint vehicle_maintenance_records_total_non_negative check (
    total_cost_cents is null or total_cost_cents >= 0
  )
);

alter table vehicle_maintenance_records
  add column if not exists public_id text;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'vehicle_maintenance_records_assign_public_id'
      and tgrelid = 'vehicle_maintenance_records'::regclass
      and not tgisinternal
  ) then
    create trigger vehicle_maintenance_records_assign_public_id
      before insert on vehicle_maintenance_records
      for each row
      execute function assign_vehicle_maintenance_records_public_id();
  end if;
end $$;

with ordered as (
  select r.id,
         row_number() over (order by r.created_at asc, r.id asc) as rn
  from vehicle_maintenance_records r
  where r.public_id is null
),
base as (
  select coalesce(max((substring(r.public_id from '^ME([0-9]+)$'))::bigint), 0) as max_n
  from vehicle_maintenance_records r
  where r.public_id ~ '^ME[0-9]+$'
)
update vehicle_maintenance_records r
set public_id = format_public_id('ME', base.max_n + ordered.rn)
from ordered, base
where r.id = ordered.id;

do $$
declare
  maintenance_max bigint;
begin
  select max((substring(public_id from '^ME([0-9]+)$'))::bigint)
    into maintenance_max
  from vehicle_maintenance_records
  where public_id ~ '^ME[0-9]+$';

  if maintenance_max is null then
    perform setval('vehicle_maintenance_records_public_id_seq', 1, false);
  else
    perform setval('vehicle_maintenance_records_public_id_seq', maintenance_max, true);
  end if;
end $$;

alter table vehicle_maintenance_records
  alter column public_id set not null;

alter table vehicle_documents
  add column if not exists maintenance_record_id uuid references vehicle_maintenance_records(id) on delete set null;

create table if not exists vehicle_finance (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  purchase_date date,
  purchase_cost_cents int,
  residual_value_cents int,
  useful_life_months int,
  depreciation_method text not null default 'STRAIGHT_LINE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_finance_purchase_cost_non_negative check (
    purchase_cost_cents is null or purchase_cost_cents >= 0
  ),
  constraint vehicle_finance_residual_non_negative check (
    residual_value_cents is null or residual_value_cents >= 0
  ),
  constraint vehicle_finance_useful_life_positive check (
    useful_life_months is null or useful_life_months >= 1
  ),
  constraint vehicle_finance_method_check check (
    depreciation_method in ('STRAIGHT_LINE')
  )
);

create table if not exists vehicle_finance_snapshots (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  snapshot_date date not null,
  revenue_cents int not null default 0,
  expenses_cents int not null default 0,
  repairs_cents int not null default 0,
  net_cents int not null default 0,
  roi_bps int,
  source text not null default 'DERIVED',
  generated_at timestamptz not null default now(),
  constraint vehicle_finance_snapshots_expenses_non_negative check (expenses_cents >= 0),
  constraint vehicle_finance_snapshots_repairs_non_negative check (repairs_cents >= 0),
  constraint vehicle_finance_snapshots_source_check check (
    source in ('DERIVED', 'MANUAL_ADJUSTMENT')
  ),
  unique (vehicle_id, snapshot_date, source)
);

create table if not exists vehicle_depreciation_snapshots (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  as_of_month date not null,
  book_value_cents int not null,
  accumulated_depreciation_cents int not null,
  depreciation_for_month_cents int not null,
  created_at timestamptz not null default now(),
  constraint vehicle_depreciation_snapshots_month_start_check check (
    as_of_month = date_trunc('month', as_of_month)::date
  ),
  constraint vehicle_depreciation_snapshots_book_non_negative check (
    book_value_cents >= 0
  ),
  constraint vehicle_depreciation_snapshots_accumulated_non_negative check (
    accumulated_depreciation_cents >= 0
  ),
  constraint vehicle_depreciation_snapshots_monthly_non_negative check (
    depreciation_for_month_cents >= 0
  ),
  unique (vehicle_id, as_of_month)
);

create table if not exists vehicle_document_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_document_id uuid not null references vehicle_documents(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (vehicle_document_id, entity_type, entity_id)
);

create index if not exists vehicle_profiles_vehicle_id_idx
  on vehicle_profiles(vehicle_id);
create index if not exists vehicle_documents_vehicle_id_idx
  on vehicle_documents(vehicle_id);
create index if not exists vehicle_documents_folder_idx
  on vehicle_documents(folder);
create index if not exists vehicle_documents_vehicle_document_type_idx
  on vehicle_documents(vehicle_id, document_type);
create index if not exists vehicle_documents_maintenance_record_id_idx
  on vehicle_documents(maintenance_record_id);
create index if not exists vehicle_documents_archived_at_idx
  on vehicle_documents(archived_at);
create unique index if not exists vehicle_checklist_templates_label_lower_unique
  on vehicle_checklist_templates(lower(label));
create index if not exists vehicle_checklist_templates_is_active_idx
  on vehicle_checklist_templates(is_active);
create index if not exists vehicle_checklist_items_vehicle_id_idx
  on vehicle_checklist_items(vehicle_id);
create index if not exists vehicle_checklist_items_template_id_idx
  on vehicle_checklist_items(template_id);
create index if not exists vehicle_checklist_items_vehicle_status_idx
  on vehicle_checklist_items(vehicle_id, status);
create index if not exists vehicle_checklist_items_archived_at_idx
  on vehicle_checklist_items(archived_at);
create index if not exists vehicle_checklist_items_uploaded_document_id_idx
  on vehicle_checklist_items(uploaded_document_id);
create index if not exists vehicle_checklist_events_vehicle_id_created_idx
  on vehicle_checklist_events(vehicle_id, created_at desc);
create index if not exists vehicle_checklist_events_item_id_created_idx
  on vehicle_checklist_events(checklist_item_id, created_at desc);
create index if not exists vehicle_notes_vehicle_id_created_at_idx
  on vehicle_notes(vehicle_id, created_at desc);
create index if not exists vehicle_notes_deleted_at_idx
  on vehicle_notes(deleted_at);
create unique index if not exists maintenance_service_types_name_lower_unique
  on maintenance_service_types(lower(name));
create index if not exists maintenance_service_types_is_active_idx
  on maintenance_service_types(is_active);
create index if not exists vehicle_maintenance_schedules_vehicle_id_idx
  on vehicle_maintenance_schedules(vehicle_id);
create index if not exists vehicle_maintenance_schedules_service_type_id_idx
  on vehicle_maintenance_schedules(service_type_id);
create index if not exists vehicle_maintenance_schedules_status_idx
  on vehicle_maintenance_schedules(status);
create index if not exists vehicle_maintenance_schedules_next_due_date_idx
  on vehicle_maintenance_schedules(next_due_date);
create index if not exists vehicle_maintenance_logs_vehicle_id_idx
  on vehicle_maintenance_logs(vehicle_id);
create index if not exists vehicle_maintenance_logs_service_date_idx
  on vehicle_maintenance_logs(service_date desc);
create index if not exists vehicle_maintenance_logs_service_type_id_idx
  on vehicle_maintenance_logs(service_type_id);
create index if not exists maintenance_reminders_vehicle_id_idx
  on maintenance_reminders(vehicle_id);
create index if not exists maintenance_reminders_schedule_id_idx
  on maintenance_reminders(schedule_id);
create index if not exists maintenance_reminders_status_idx
  on maintenance_reminders(status);
create index if not exists maintenance_reminders_remind_at_idx
  on maintenance_reminders(remind_at);
create unique index if not exists maintenance_reminders_schedule_remind_channel_unique
  on maintenance_reminders(schedule_id, channel, ((remind_at at time zone 'UTC')::date));
create index if not exists vehicle_maintenance_records_vehicle_status_idx
  on vehicle_maintenance_records(vehicle_id, status);
create index if not exists vehicle_maintenance_records_scheduled_date_idx
  on vehicle_maintenance_records(scheduled_date);
create index if not exists vehicle_maintenance_records_next_due_date_idx
  on vehicle_maintenance_records(next_due_date);
create index if not exists vehicle_maintenance_records_category_idx
  on vehicle_maintenance_records(category);
create index if not exists vehicle_maintenance_records_archived_at_idx
  on vehicle_maintenance_records(archived_at);
create unique index if not exists vehicle_maintenance_records_public_id_unique_idx
  on vehicle_maintenance_records(public_id);
create index if not exists vehicle_finance_snapshots_vehicle_date_idx
  on vehicle_finance_snapshots(vehicle_id, snapshot_date desc);
create index if not exists vehicle_finance_snapshots_snapshot_date_idx
  on vehicle_finance_snapshots(snapshot_date desc);
create index if not exists vehicle_depreciation_snapshots_as_of_month_idx
  on vehicle_depreciation_snapshots(as_of_month);
create index if not exists vehicle_depreciation_snapshots_vehicle_id_idx
  on vehicle_depreciation_snapshots(vehicle_id);
create index if not exists vehicle_document_links_entity_idx
  on vehicle_document_links(entity_type, entity_id);
create index if not exists vehicle_document_links_vehicle_document_id_idx
  on vehicle_document_links(vehicle_document_id);

create table if not exists booking_private_files (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  document_type text not null,
  storage_provider text not null default 'UPLOADCARE',
  storage_key text not null,
  original_file_name text,
  mime_type text,
  byte_size int,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint booking_private_files_document_type_check check (
    document_type in ('DRIVERS_LICENSE', 'SIGNATURE', 'OTHER')
  ),
  constraint booking_private_files_byte_size_check check (byte_size is null or byte_size >= 0)
);

create index if not exists booking_private_files_booking_id_idx
  on booking_private_files(booking_id);
create index if not exists booking_private_files_document_type_idx
  on booking_private_files(document_type);
create index if not exists booking_private_files_created_at_idx
  on booking_private_files(created_at);

alter table customers
  add column if not exists first_name text;
alter table customers
  add column if not exists last_name text;
alter table customers
  add column if not exists drivers_license_number text;
alter table customers
  add column if not exists drivers_license_country text;
alter table customers
  add column if not exists street text;
alter table customers
  add column if not exists street2 text;
alter table customers
  add column if not exists city text;
alter table customers
  add column if not exists state text;
alter table customers
  add column if not exists zip text;
alter table customers
  add column if not exists country text;
alter table customers
  add column if not exists birthday date;

create index if not exists customers_first_name_idx on customers(first_name);
create index if not exists customers_last_name_idx on customers(last_name);
create unique index if not exists customers_drivers_license_number_lower_unique
  on customers(lower(drivers_license_number))
  where coalesce(trim(drivers_license_number), '') <> '';

alter table bookings
  add column if not exists pickup_location_id uuid references booking_locations(id) on delete set null;
alter table bookings
  add column if not exists dropoff_location_id uuid references booking_locations(id) on delete set null;
alter table bookings
  add column if not exists dropoff_location text;
alter table bookings
  add column if not exists pickup_location_text_snapshot text;
alter table bookings
  add column if not exists dropoff_location_text_snapshot text;
alter table bookings
  add column if not exists pickup_time time;
alter table bookings
  add column if not exists dropoff_time time;
alter table bookings
  add column if not exists start_at timestamptz;
alter table bookings
  add column if not exists end_at timestamptz;
alter table bookings
  add column if not exists insurance_selected boolean not null default false;
alter table bookings
  add column if not exists insurance_plan_id uuid references insurance_plans(id) on delete set null;
alter table bookings
  add column if not exists insurance_price_per_day_cents int not null default 0;
alter table bookings
  add column if not exists insurance_total_cents int not null default 0;
alter table bookings
  add column if not exists payment_option text not null default 'DEPOSIT';
alter table bookings
  add column if not exists custom_payment_amount_cents int;
alter table bookings
  add column if not exists drivers_license_number text;
alter table bookings
  add column if not exists drivers_license_expiration_date date;
alter table bookings
  add column if not exists drivers_license_uploaded_at timestamptz;
alter table bookings
  add column if not exists signature_signed_at timestamptz;

alter table bookings
  drop constraint if exists bookings_payment_option_check;
alter table bookings
  add constraint bookings_payment_option_check check (
    payment_option in ('DEPOSIT', 'FULL', 'CUSTOM', 'NONE')
  );

alter table bookings
  drop constraint if exists bookings_custom_payment_amount_cents_check;
alter table bookings
  add constraint bookings_custom_payment_amount_cents_check check (
    custom_payment_amount_cents is null or custom_payment_amount_cents >= 0
  );

alter table bookings
  drop constraint if exists bookings_insurance_price_per_day_cents_check;
alter table bookings
  add constraint bookings_insurance_price_per_day_cents_check check (
    insurance_price_per_day_cents >= 0
  );

alter table bookings
  drop constraint if exists bookings_insurance_total_cents_check;
alter table bookings
  add constraint bookings_insurance_total_cents_check check (
    insurance_total_cents >= 0
  );

create index if not exists bookings_pickup_location_id_idx on bookings(pickup_location_id);
create index if not exists bookings_dropoff_location_id_idx on bookings(dropoff_location_id);
create index if not exists bookings_start_at_end_at_idx on bookings(start_at, end_at);
create index if not exists bookings_payment_option_idx on bookings(payment_option);
