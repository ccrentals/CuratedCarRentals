-- Depreciation module V5 (additive only; vehicles table unchanged)

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

create index if not exists vehicle_depreciation_snapshots_as_of_month_idx
  on vehicle_depreciation_snapshots(as_of_month);
create index if not exists vehicle_depreciation_snapshots_vehicle_id_idx
  on vehicle_depreciation_snapshots(vehicle_id);

