-- Booking revamp foundation:
-- - pickup/dropoff locations
-- - insurance configuration
-- - secure booking file references (driver's license/signature)
-- - extended customer + booking fields for 6-step public flow

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
  on booking_locations (lower(label));
create index if not exists booking_locations_active_sort_idx
  on booking_locations (is_active, sort_order, label);

-- Bootstrap location list from existing booking pickup location values.
insert into booking_locations (label, allow_pickup, allow_dropoff, is_active)
select distinct trim(b.pickup_location), true, true, true
from bookings b
where trim(coalesce(b.pickup_location, '')) <> ''
on conflict do nothing;

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

alter table if exists customers
  add column if not exists first_name text;
alter table if exists customers
  add column if not exists last_name text;
alter table if exists customers
  add column if not exists drivers_license_number text;
alter table if exists customers
  add column if not exists drivers_license_country text;
alter table if exists customers
  add column if not exists street text;
alter table if exists customers
  add column if not exists street2 text;
alter table if exists customers
  add column if not exists city text;
alter table if exists customers
  add column if not exists state text;
alter table if exists customers
  add column if not exists zip text;
alter table if exists customers
  add column if not exists country text;
alter table if exists customers
  add column if not exists birthday date;

update customers
set first_name = split_part(trim(full_name), ' ', 1)
where coalesce(trim(first_name), '') = ''
  and coalesce(trim(full_name), '') <> '';

update customers
set last_name = nullif(trim(regexp_replace(trim(full_name), '^\S+\s*', '')), '')
where coalesce(trim(last_name), '') = ''
  and coalesce(trim(full_name), '') <> '';

-- Backfill dedicated driver's license lookup field from legacy legal ID storage where applicable.
update customers
set drivers_license_number = trim(legal_id_number)
where coalesce(trim(drivers_license_number), '') = ''
  and upper(coalesce(legal_id_type, '')) = 'DRIVERS_LICENSE'
  and coalesce(trim(legal_id_number), '') <> '';

-- Preserve migration safety if historical duplicates exist by keeping the earliest row populated.
with ranked as (
  select
    id,
    row_number() over (
      partition by lower(trim(drivers_license_number))
      order by created_at asc, id asc
    ) as rn
  from customers
  where coalesce(trim(drivers_license_number), '') <> ''
)
update customers c
set drivers_license_number = null
from ranked r
where c.id = r.id
  and r.rn > 1;

create index if not exists customers_first_name_idx on customers(first_name);
create index if not exists customers_last_name_idx on customers(last_name);
create unique index if not exists customers_drivers_license_number_lower_unique
  on customers(lower(drivers_license_number))
  where coalesce(trim(drivers_license_number), '') <> '';

alter table if exists bookings
  add column if not exists pickup_location_id uuid references booking_locations(id) on delete set null;
alter table if exists bookings
  add column if not exists dropoff_location_id uuid references booking_locations(id) on delete set null;
alter table if exists bookings
  add column if not exists dropoff_location text;
alter table if exists bookings
  add column if not exists pickup_location_text_snapshot text;
alter table if exists bookings
  add column if not exists dropoff_location_text_snapshot text;
alter table if exists bookings
  add column if not exists pickup_time time;
alter table if exists bookings
  add column if not exists dropoff_time time;
alter table if exists bookings
  add column if not exists start_at timestamptz;
alter table if exists bookings
  add column if not exists end_at timestamptz;
alter table if exists bookings
  add column if not exists insurance_selected boolean not null default false;
alter table if exists bookings
  add column if not exists insurance_plan_id uuid references insurance_plans(id) on delete set null;
alter table if exists bookings
  add column if not exists insurance_price_per_day_cents int not null default 0;
alter table if exists bookings
  add column if not exists insurance_total_cents int not null default 0;
alter table if exists bookings
  add column if not exists payment_option text;
alter table if exists bookings
  add column if not exists custom_payment_amount_cents int;
alter table if exists bookings
  add column if not exists drivers_license_number text;
alter table if exists bookings
  add column if not exists drivers_license_expiration_date date;
alter table if exists bookings
  add column if not exists drivers_license_uploaded_at timestamptz;
alter table if exists bookings
  add column if not exists signature_signed_at timestamptz;

update bookings
set pickup_location_text_snapshot = pickup_location
where coalesce(trim(pickup_location_text_snapshot), '') = ''
  and coalesce(trim(pickup_location), '') <> '';

update bookings
set dropoff_location = pickup_location
where coalesce(trim(dropoff_location), '') = ''
  and coalesce(trim(pickup_location), '') <> '';

update bookings
set dropoff_location_text_snapshot = dropoff_location
where coalesce(trim(dropoff_location_text_snapshot), '') = ''
  and coalesce(trim(dropoff_location), '') <> '';

update bookings
set start_at = start_date::timestamptz
where start_at is null;

-- Existing date-only bookings are treated as [start_date, end_date + 1 day) for continuity.
update bookings
set end_at = (end_date::timestamptz + interval '1 day')
where end_at is null;

update bookings
set payment_option = case upper(coalesce(pricing_json->>'payment_option_selected', ''))
  when 'FULL' then 'FULL'
  when 'CUSTOM' then 'CUSTOM'
  when 'PAY_ON_PICKUP' then 'NONE'
  when 'NONE' then 'NONE'
  else 'DEPOSIT'
end
where payment_option is null;

update bookings
set custom_payment_amount_cents = case
  when coalesce(pricing_json->>'custom_payment_amount_cents', '') ~ '^[0-9]+(\.[0-9]+)?$'
    then round((pricing_json->>'custom_payment_amount_cents')::numeric)::int
  when coalesce(pricing_json->>'custom_amount_cents', '') ~ '^[0-9]+(\.[0-9]+)?$'
    then round((pricing_json->>'custom_amount_cents')::numeric)::int
  else custom_payment_amount_cents
end
where custom_payment_amount_cents is null;

alter table if exists bookings
  alter column payment_option set default 'DEPOSIT';

update bookings
set payment_option = 'DEPOSIT'
where payment_option is null;

alter table if exists bookings
  alter column payment_option set not null;

alter table if exists bookings
  drop constraint if exists bookings_payment_option_check;
alter table if exists bookings
  add constraint bookings_payment_option_check check (
    payment_option in ('DEPOSIT', 'FULL', 'CUSTOM', 'NONE')
  );

alter table if exists bookings
  drop constraint if exists bookings_custom_payment_amount_cents_check;
alter table if exists bookings
  add constraint bookings_custom_payment_amount_cents_check check (
    custom_payment_amount_cents is null or custom_payment_amount_cents >= 0
  );

alter table if exists bookings
  drop constraint if exists bookings_insurance_price_per_day_cents_check;
alter table if exists bookings
  add constraint bookings_insurance_price_per_day_cents_check check (
    insurance_price_per_day_cents >= 0
  );

alter table if exists bookings
  drop constraint if exists bookings_insurance_total_cents_check;
alter table if exists bookings
  add constraint bookings_insurance_total_cents_check check (
    insurance_total_cents >= 0
  );

create index if not exists bookings_pickup_location_id_idx on bookings(pickup_location_id);
create index if not exists bookings_dropoff_location_id_idx on bookings(dropoff_location_id);
create index if not exists bookings_start_at_end_at_idx on bookings(start_at, end_at);
create index if not exists bookings_payment_option_idx on bookings(payment_option);
