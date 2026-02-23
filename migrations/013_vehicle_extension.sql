-- Vehicle module V1 extension tables (additive only, vehicles table unchanged)

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
  constraint vehicle_profiles_odometer_non_negative check (odometer_value is null or odometer_value >= 0),
  constraint vehicle_profiles_fuel_level_range check (
    fuel_level_value is null or (fuel_level_value >= 0 and fuel_level_value <= 100)
  )
);

create table if not exists vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  folder text not null default 'Unsorted',
  document_type text,
  title text not null,
  storage_provider text not null default 'UPLOADCARE_FILE_ID',
  storage_key text not null,
  mime_type text,
  size_bytes bigint,
  tags jsonb not null default '[]'::jsonb,
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vehicle_documents_size_non_negative check (size_bytes is null or size_bytes >= 0)
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

create index if not exists vehicle_profiles_vehicle_id_idx
  on vehicle_profiles(vehicle_id);
create index if not exists vehicle_documents_vehicle_id_idx
  on vehicle_documents(vehicle_id);
create index if not exists vehicle_documents_folder_idx
  on vehicle_documents(folder);
create index if not exists vehicle_checklist_items_vehicle_id_idx
  on vehicle_checklist_items(vehicle_id);
