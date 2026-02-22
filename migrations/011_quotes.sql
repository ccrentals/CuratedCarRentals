-- Quotes foundation

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

create index if not exists quotes_status_created_idx
  on quotes(status, created_at desc);
create index if not exists quotes_start_end_idx
  on quotes(start_at, end_at);
create index if not exists quotes_customer_email_lower_idx
  on quotes(lower(customer_email));
create index if not exists quotes_vehicle_id_idx
  on quotes(vehicle_id);

create table if not exists quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  created_at timestamptz not null default now(),
  event_type text not null,
  actor_admin_user_id uuid references users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  constraint quote_events_event_type_check check (
    event_type in ('CREATED', 'UPDATED', 'EMAILED', 'STATUS_CHANGED', 'CONVERTED')
  )
);

create index if not exists quote_events_quote_created_idx
  on quote_events(quote_id, created_at desc);
create index if not exists quote_events_event_type_idx
  on quote_events(event_type, created_at desc);
