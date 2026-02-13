-- Customer profile enrichment
alter table customers
  add column if not exists address text;

alter table customers
  add column if not exists notes text;

alter table customers
  add column if not exists last_booked_at timestamptz;

create index if not exists customers_email_lower_idx on customers (lower(email));
create index if not exists customers_phone_idx on customers(phone);
create index if not exists customers_last_booked_at_idx on customers(last_booked_at);

-- Promo codes
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
create index if not exists promo_codes_active_idx on promo_codes(is_active);
create index if not exists promo_codes_start_idx on promo_codes(start_at);
create index if not exists promo_codes_end_idx on promo_codes(end_at);

-- Redemption log used for limits + auditability.
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

create index if not exists promo_redemptions_promo_code_id_idx on promo_redemptions(promo_code_id);
create index if not exists promo_redemptions_booking_id_idx on promo_redemptions(booking_id);
create index if not exists promo_redemptions_customer_id_idx on promo_redemptions(customer_id);
create index if not exists promo_redemptions_customer_email_lower_idx on promo_redemptions (lower(customer_email));
