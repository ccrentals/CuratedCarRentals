-- Vehicle maintenance records V6 (additive only; vehicles table unchanged)

create table if not exists vehicle_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  status text not null,
  category text not null,
  title text not null,
  description text,
  vendor_name text,
  vendor_contact text,
  reference_number text,
  service_date date,
  scheduled_date date,
  odometer_km int,
  next_due_date date,
  next_due_odometer_km int,
  labor_cost_cents int,
  parts_cost_cents int,
  tax_cost_cents int,
  total_cost_cents int,
  currency text not null default 'JMD',
  priority text not null default 'NORMAL',
  created_by_user_id uuid references users(id) on delete set null,
  completed_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint vehicle_maintenance_records_status_check check (
    status in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  constraint vehicle_maintenance_records_category_check check (
    category in (
      'SERVICE',
      'REPAIR',
      'INSPECTION',
      'REGISTRATION',
      'INSURANCE',
      'TIRE',
      'BRAKE',
      'BATTERY',
      'OTHER'
    )
  ),
  constraint vehicle_maintenance_records_priority_check check (
    priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')
  ),
  constraint vehicle_maintenance_records_currency_check check (
    currency = 'JMD'
  ),
  constraint vehicle_maintenance_records_odometer_non_negative check (
    odometer_km is null or odometer_km >= 0
  ),
  constraint vehicle_maintenance_records_next_due_odometer_non_negative check (
    next_due_odometer_km is null or next_due_odometer_km >= 0
  ),
  constraint vehicle_maintenance_records_labor_non_negative check (
    labor_cost_cents is null or labor_cost_cents >= 0
  ),
  constraint vehicle_maintenance_records_parts_non_negative check (
    parts_cost_cents is null or parts_cost_cents >= 0
  ),
  constraint vehicle_maintenance_records_tax_non_negative check (
    tax_cost_cents is null or tax_cost_cents >= 0
  ),
  constraint vehicle_maintenance_records_total_non_negative check (
    total_cost_cents is null or total_cost_cents >= 0
  )
);

create index if not exists vehicle_maintenance_records_vehicle_status_idx
  on vehicle_maintenance_records(vehicle_id, status);
create index if not exists vehicle_maintenance_records_scheduled_date_idx
  on vehicle_maintenance_records(scheduled_date);
create index if not exists vehicle_maintenance_records_next_due_date_idx
  on vehicle_maintenance_records(next_due_date);
create index if not exists vehicle_maintenance_records_category_idx
  on vehicle_maintenance_records(category);
create index if not exists vehicle_maintenance_records_archived_at_idx
  on vehicle_maintenance_records(archived_at);

alter table vehicle_documents
  add column if not exists maintenance_record_id uuid references vehicle_maintenance_records(id) on delete set null;
alter table vehicle_documents
  add column if not exists label text;
alter table vehicle_documents
  add column if not exists file_size_bytes int;
alter table vehicle_documents
  add column if not exists archived_at timestamptz;

alter table vehicle_documents
  alter column document_type set default 'OTHER';

update vehicle_documents
set document_type = 'OTHER'
where document_type is null;

alter table vehicle_documents
  alter column document_type set not null;

update vehicle_documents
set file_size_bytes = least(greatest(size_bytes::bigint, 0), 2147483647)::int
where file_size_bytes is null
  and size_bytes is not null;

alter table vehicle_documents
  drop constraint if exists vehicle_documents_file_size_non_negative;
alter table vehicle_documents
  add constraint vehicle_documents_file_size_non_negative check (
    file_size_bytes is null or file_size_bytes >= 0
  );

create index if not exists vehicle_documents_vehicle_document_type_idx
  on vehicle_documents(vehicle_id, document_type);
create index if not exists vehicle_documents_maintenance_record_id_idx
  on vehicle_documents(maintenance_record_id);
create index if not exists vehicle_documents_archived_at_idx
  on vehicle_documents(archived_at);
