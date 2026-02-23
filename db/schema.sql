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
