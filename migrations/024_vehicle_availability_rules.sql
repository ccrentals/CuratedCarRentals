-- Vehicle-scoped availability rules beyond blockouts (additive, idempotent)

create table if not exists vehicle_availability_rules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references vehicles(id) on delete cascade,
  advance_notice_hours int not null default 0,
  buffer_before_minutes int not null default 0,
  buffer_after_minutes int not null default 0,
  allowed_pickup_start_hour int,
  allowed_pickup_end_hour int,
  allowed_dropoff_start_hour int,
  allowed_dropoff_end_hour int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_availability_rules_advance_notice_non_negative
    check (advance_notice_hours >= 0),
  constraint vehicle_availability_rules_buffer_before_non_negative
    check (buffer_before_minutes >= 0),
  constraint vehicle_availability_rules_buffer_after_non_negative
    check (buffer_after_minutes >= 0),
  constraint vehicle_availability_rules_pickup_start_hour_range
    check (allowed_pickup_start_hour is null or allowed_pickup_start_hour between 0 and 23),
  constraint vehicle_availability_rules_pickup_end_hour_range
    check (allowed_pickup_end_hour is null or allowed_pickup_end_hour between 0 and 23),
  constraint vehicle_availability_rules_dropoff_start_hour_range
    check (allowed_dropoff_start_hour is null or allowed_dropoff_start_hour between 0 and 23),
  constraint vehicle_availability_rules_dropoff_end_hour_range
    check (allowed_dropoff_end_hour is null or allowed_dropoff_end_hour between 0 and 23),
  constraint vehicle_availability_rules_pickup_hour_order
    check (
      allowed_pickup_start_hour is null
      or allowed_pickup_end_hour is null
      or allowed_pickup_start_hour <= allowed_pickup_end_hour
    ),
  constraint vehicle_availability_rules_dropoff_hour_order
    check (
      allowed_dropoff_start_hour is null
      or allowed_dropoff_end_hour is null
      or allowed_dropoff_start_hour <= allowed_dropoff_end_hour
    )
);

create index if not exists vehicle_availability_rules_vehicle_id_idx
  on vehicle_availability_rules(vehicle_id);

create index if not exists vehicle_availability_rules_active_idx
  on vehicle_availability_rules(is_active);
