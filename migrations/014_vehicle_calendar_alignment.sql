-- Vehicle/calendar alignment placeholders (additive only; vehicles table unchanged)

alter table vehicle_profiles
  add column if not exists needs_cleaning boolean not null default false;

create table if not exists vehicle_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_date date not null,
  service_type text not null,
  odometer_value int,
  cost_cents int,
  notes text,
  created_at timestamptz not null default now(),
  constraint vehicle_maintenance_logs_odometer_non_negative check (
    odometer_value is null or odometer_value >= 0
  ),
  constraint vehicle_maintenance_logs_cost_non_negative check (
    cost_cents is null or cost_cents >= 0
  )
);

create index if not exists vehicle_maintenance_logs_vehicle_id_idx
  on vehicle_maintenance_logs(vehicle_id);
create index if not exists vehicle_maintenance_logs_service_date_idx
  on vehicle_maintenance_logs(service_date desc);
