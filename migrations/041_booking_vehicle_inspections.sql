create table if not exists booking_vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  inspection_type text not null,
  status text not null default 'DRAFT',
  odometer_value int,
  odometer_unit text,
  fuel_level_eighths int,
  damage_present boolean,
  notes text,
  recorded_by_user_id uuid references users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_vehicle_inspections_type_check check (
    inspection_type in ('PICKUP', 'RETURN')
  ),
  constraint booking_vehicle_inspections_status_check check (
    status in ('DRAFT', 'COMPLETED')
  ),
  constraint booking_vehicle_inspections_odometer_check check (
    odometer_value is null or odometer_value >= 0
  ),
  constraint booking_vehicle_inspections_fuel_level_check check (
    fuel_level_eighths is null or fuel_level_eighths between 0 and 8
  ),
  constraint booking_vehicle_inspections_notes_length_check check (
    notes is null or char_length(notes) <= 4000
  ),
  constraint booking_vehicle_inspections_booking_type_unique unique (booking_id, inspection_type)
);

create table if not exists booking_vehicle_inspection_images (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references booking_vehicle_inspections(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  inspection_type text not null,
  category text not null default 'OTHER',
  label text,
  storage_provider text not null default 'UPLOADCARE',
  storage_key text not null,
  original_file_name text,
  generated_file_name text,
  mime_type text,
  byte_size int,
  sort_order int not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint booking_vehicle_inspection_images_type_check check (
    inspection_type in ('PICKUP', 'RETURN')
  ),
  constraint booking_vehicle_inspection_images_category_check check (
    category in ('EXTERIOR', 'INTERIOR', 'ODOMETER', 'FUEL_GAUGE', 'DAMAGE', 'OTHER')
  ),
  constraint booking_vehicle_inspection_images_byte_size_check check (
    byte_size is null or byte_size >= 0
  ),
  constraint booking_vehicle_inspection_images_sort_order_check check (
    sort_order >= 0
  )
);

create index if not exists booking_vehicle_inspections_booking_id_idx
  on booking_vehicle_inspections(booking_id);
create index if not exists booking_vehicle_inspections_vehicle_id_idx
  on booking_vehicle_inspections(vehicle_id);
create index if not exists booking_vehicle_inspections_status_idx
  on booking_vehicle_inspections(status);
create index if not exists booking_vehicle_inspections_type_idx
  on booking_vehicle_inspections(inspection_type);
create index if not exists booking_vehicle_inspection_images_inspection_id_idx
  on booking_vehicle_inspection_images(inspection_id);
create index if not exists booking_vehicle_inspection_images_booking_id_idx
  on booking_vehicle_inspection_images(booking_id);
create index if not exists booking_vehicle_inspection_images_type_idx
  on booking_vehicle_inspection_images(inspection_type);
create index if not exists booking_vehicle_inspection_images_category_idx
  on booking_vehicle_inspection_images(category);
create index if not exists booking_vehicle_inspection_images_archived_at_idx
  on booking_vehicle_inspection_images(archived_at);
