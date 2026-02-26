-- Vehicle-scoped pricing rules and delivery options (additive, idempotent)

create table if not exists vehicle_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references vehicles(id) on delete cascade,
  base_daily_rate_cents int,
  base_deposit_cents int,
  weekend_daily_rate_cents int,
  date_range_overrides_json jsonb not null default '[]'::jsonb,
  delivery_enabled boolean not null default false,
  delivery_fee_cents int not null default 0,
  delivery_zones_json jsonb not null default '[]'::jsonb,
  currency text not null default 'JMD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_pricing_rules_base_daily_non_negative
    check (base_daily_rate_cents is null or base_daily_rate_cents >= 0),
  constraint vehicle_pricing_rules_base_deposit_non_negative
    check (base_deposit_cents is null or base_deposit_cents >= 0),
  constraint vehicle_pricing_rules_weekend_non_negative
    check (weekend_daily_rate_cents is null or weekend_daily_rate_cents >= 0),
  constraint vehicle_pricing_rules_delivery_fee_non_negative
    check (delivery_fee_cents >= 0),
  constraint vehicle_pricing_rules_currency_not_blank
    check (length(trim(currency)) > 0)
);

create index if not exists vehicle_pricing_rules_vehicle_id_idx
  on vehicle_pricing_rules(vehicle_id);

create index if not exists vehicle_pricing_rules_active_idx
  on vehicle_pricing_rules(is_active);
