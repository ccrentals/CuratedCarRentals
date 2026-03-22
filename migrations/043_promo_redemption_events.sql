create table if not exists promo_redemption_events (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  customer_email text,
  discount_amount_cents int not null,
  event_type text not null,
  event_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint promo_redemption_events_type_check check (event_type in ('REDEEMED', 'REVERSED'))
);

create index if not exists promo_redemption_events_promo_code_id_idx
  on promo_redemption_events(promo_code_id);

create index if not exists promo_redemption_events_booking_id_idx
  on promo_redemption_events(booking_id);

create index if not exists promo_redemption_events_event_at_idx
  on promo_redemption_events(event_at desc);

create index if not exists promo_redemption_events_customer_id_idx
  on promo_redemption_events(customer_id);

create index if not exists promo_redemption_events_customer_email_lower_idx
  on promo_redemption_events (lower(customer_email));
