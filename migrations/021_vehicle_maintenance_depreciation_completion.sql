-- Vehicle maintenance/depreciation completion (additive only; vehicles table unchanged)

alter table vehicle_maintenance_records
  add column if not exists reminder_lead_days int,
  add column if not exists linked_expense_id uuid,
  add column if not exists linked_repair_order_id uuid,
  add column if not exists completed_date date,
  add column if not exists estimated_cost_cents int,
  add column if not exists actual_cost_cents int;

update vehicle_maintenance_records
set completed_date = coalesce(completed_date, service_date)
where upper(status) = 'COMPLETED'
  and completed_date is null;

alter table vehicle_maintenance_records
  drop constraint if exists vehicle_maintenance_records_reminder_lead_days_non_negative;
alter table vehicle_maintenance_records
  add constraint vehicle_maintenance_records_reminder_lead_days_non_negative check (
    reminder_lead_days is null or reminder_lead_days >= 0
  );

alter table vehicle_maintenance_records
  drop constraint if exists vehicle_maintenance_records_estimated_cost_non_negative;
alter table vehicle_maintenance_records
  add constraint vehicle_maintenance_records_estimated_cost_non_negative check (
    estimated_cost_cents is null or estimated_cost_cents >= 0
  );

alter table vehicle_maintenance_records
  drop constraint if exists vehicle_maintenance_records_actual_cost_non_negative;
alter table vehicle_maintenance_records
  add constraint vehicle_maintenance_records_actual_cost_non_negative check (
    actual_cost_cents is null or actual_cost_cents >= 0
  );

create index if not exists vehicle_maintenance_records_completed_date_idx
  on vehicle_maintenance_records(completed_date);
create index if not exists vehicle_maintenance_records_linked_expense_idx
  on vehicle_maintenance_records(linked_expense_id);
create index if not exists vehicle_maintenance_records_linked_repair_idx
  on vehicle_maintenance_records(linked_repair_order_id);

create table if not exists vehicle_maintenance_status_history (
  id uuid primary key default gen_random_uuid(),
  maintenance_record_id uuid not null references vehicle_maintenance_records(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  previous_status text,
  next_status text not null,
  note text,
  changed_by_user_id uuid references users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint vehicle_maintenance_status_history_previous_status_check check (
    previous_status is null
    or upper(previous_status) in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  constraint vehicle_maintenance_status_history_next_status_check check (
    upper(next_status) in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  )
);

create index if not exists vehicle_maintenance_status_history_record_idx
  on vehicle_maintenance_status_history(maintenance_record_id, changed_at desc);
create index if not exists vehicle_maintenance_status_history_vehicle_idx
  on vehicle_maintenance_status_history(vehicle_id, changed_at desc);

alter table vehicle_finance
  add column if not exists odometer_at_purchase int,
  add column if not exists is_active boolean not null default true;

alter table vehicle_finance
  drop constraint if exists vehicle_finance_odometer_at_purchase_non_negative;
alter table vehicle_finance
  add constraint vehicle_finance_odometer_at_purchase_non_negative check (
    odometer_at_purchase is null or odometer_at_purchase >= 0
  );

create index if not exists vehicle_finance_is_active_idx
  on vehicle_finance(is_active);

create table if not exists vehicle_depreciation_profiles (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  purchase_price_cents int,
  expected_rest_value_cents int,
  purchase_date date,
  odometer_at_purchase_km int,
  depreciation_months int,
  method text not null default 'STRAIGHT_LINE',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id),
  constraint vehicle_depreciation_profiles_purchase_price_non_negative check (
    purchase_price_cents is null or purchase_price_cents >= 0
  ),
  constraint vehicle_depreciation_profiles_rest_value_non_negative check (
    expected_rest_value_cents is null or expected_rest_value_cents >= 0
  ),
  constraint vehicle_depreciation_profiles_odometer_non_negative check (
    odometer_at_purchase_km is null or odometer_at_purchase_km >= 0
  ),
  constraint vehicle_depreciation_profiles_months_positive check (
    depreciation_months is null or depreciation_months >= 1
  ),
  constraint vehicle_depreciation_profiles_method_check check (
    method in ('STRAIGHT_LINE')
  )
);

create index if not exists vehicle_depreciation_profiles_vehicle_id_idx
  on vehicle_depreciation_profiles(vehicle_id);
create index if not exists vehicle_depreciation_profiles_active_idx
  on vehicle_depreciation_profiles(is_active);

insert into vehicle_depreciation_profiles (
  vehicle_id,
  purchase_price_cents,
  expected_rest_value_cents,
  purchase_date,
  odometer_at_purchase_km,
  depreciation_months,
  method,
  is_active,
  notes,
  created_at,
  updated_at
)
select
  vf.vehicle_id,
  vf.purchase_cost_cents,
  vf.residual_value_cents,
  vf.purchase_date,
  vf.odometer_at_purchase,
  vf.useful_life_months,
  vf.depreciation_method,
  vf.is_active,
  vf.notes,
  vf.created_at,
  vf.updated_at
from vehicle_finance vf
on conflict (vehicle_id) do update
set purchase_price_cents = excluded.purchase_price_cents,
    expected_rest_value_cents = excluded.expected_rest_value_cents,
    purchase_date = excluded.purchase_date,
    odometer_at_purchase_km = excluded.odometer_at_purchase_km,
    depreciation_months = excluded.depreciation_months,
    method = excluded.method,
    is_active = excluded.is_active,
    notes = excluded.notes,
    updated_at = now();

-- Blockout linkage is optional; only apply when blockouts exists.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'blockouts'
  ) then
    alter table blockouts
      add column if not exists linked_maintenance_id uuid references vehicle_maintenance_records(id) on delete set null,
      add column if not exists source text not null default 'MANUAL';

    update blockouts
    set source = 'MANUAL'
    where source is null or btrim(source) = '';

    alter table blockouts
      drop constraint if exists blockouts_source_check;
    alter table blockouts
      add constraint blockouts_source_check check (source in ('MANUAL', 'MAINTENANCE'));

    create unique index if not exists blockouts_linked_maintenance_unique
      on blockouts(linked_maintenance_id)
      where linked_maintenance_id is not null;

    create index if not exists blockouts_linked_maintenance_idx
      on blockouts(linked_maintenance_id);
  end if;
end $$;
