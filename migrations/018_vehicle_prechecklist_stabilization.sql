-- Vehicle pre-checklist stabilization (additive only; vehicles table unchanged)

create table if not exists vehicle_profiles (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  vin text,
  license_plate text,
  vehicle_type text,
  vehicle_class text,
  year int,
  color text,
  current_location_label text,
  odometer_value int,
  odometer_unit text not null default 'KM',
  fuel_level_value int,
  available_from date,
  available_until date,
  entry_date date,
  exit_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_profiles_odometer_non_negative check (
    odometer_value is null or odometer_value >= 0
  ),
  constraint vehicle_profiles_fuel_level_range check (
    fuel_level_value is null or (fuel_level_value >= 0 and fuel_level_value <= 100)
  )
);

alter table vehicle_profiles
  add column if not exists needs_cleaning boolean not null default false;

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

create table if not exists vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  folder text not null default 'Unsorted',
  document_type text not null default 'OTHER',
  title text not null,
  label text,
  storage_provider text not null default 'UPLOADCARE_FILE_ID',
  storage_key text not null,
  mime_type text,
  size_bytes bigint,
  file_size_bytes int,
  tags jsonb not null default '[]'::jsonb,
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table vehicle_documents
  add column if not exists maintenance_record_id uuid references vehicle_maintenance_records(id) on delete set null;

alter table vehicle_documents
  drop constraint if exists vehicle_documents_size_non_negative;
alter table vehicle_documents
  add constraint vehicle_documents_size_non_negative check (size_bytes is null or size_bytes >= 0);

alter table vehicle_documents
  drop constraint if exists vehicle_documents_file_size_non_negative;
alter table vehicle_documents
  add constraint vehicle_documents_file_size_non_negative check (
    file_size_bytes is null or file_size_bytes >= 0
  );

create table if not exists vehicle_checklist_items (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  label text not null,
  folder text not null default 'Unsorted',
  required boolean not null default false,
  uploaded_document_id uuid references vehicle_documents(id) on delete set null,
  expiration_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_notes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  note_text text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

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

create index if not exists vehicle_profiles_vehicle_id_idx
  on vehicle_profiles(vehicle_id);
create index if not exists vehicle_documents_vehicle_id_idx
  on vehicle_documents(vehicle_id);
create index if not exists vehicle_documents_folder_idx
  on vehicle_documents(folder);
create index if not exists vehicle_documents_vehicle_document_type_idx
  on vehicle_documents(vehicle_id, document_type);
create index if not exists vehicle_documents_maintenance_record_id_idx
  on vehicle_documents(maintenance_record_id);
create index if not exists vehicle_documents_archived_at_idx
  on vehicle_documents(archived_at);
create index if not exists vehicle_checklist_items_vehicle_id_idx
  on vehicle_checklist_items(vehicle_id);
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
create index if not exists vehicle_notes_vehicle_id_created_at_idx
  on vehicle_notes(vehicle_id, created_at desc);
create index if not exists vehicle_notes_deleted_at_idx
  on vehicle_notes(deleted_at);
create index if not exists blockouts_vehicle_id_idx on blockouts(vehicle_id);
create index if not exists blockouts_range_idx on blockouts(start_at, end_at);
