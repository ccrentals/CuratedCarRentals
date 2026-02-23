-- Maintenance module V4 (additive only; vehicles table unchanged)

create table if not exists maintenance_service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  default_interval_days int,
  default_interval_odometer int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_service_types_default_interval_days_check check (
    default_interval_days is null or default_interval_days >= 1
  ),
  constraint maintenance_service_types_default_interval_odometer_check check (
    default_interval_odometer is null or default_interval_odometer >= 1
  )
);

create unique index if not exists maintenance_service_types_name_lower_unique
  on maintenance_service_types(lower(name));
create index if not exists maintenance_service_types_is_active_idx
  on maintenance_service_types(is_active);

insert into maintenance_service_types (name, description, default_interval_days, default_interval_odometer)
select seed.name, seed.description, seed.default_interval_days, seed.default_interval_odometer
from (
  values
    ('General', 'General maintenance service', null, null),
    ('Oil Change', 'Engine oil and filter service', 180, 8000),
    ('Tire Rotation', 'Rotate tires and inspect tread wear', 180, 10000),
    ('Brake Inspection', 'Inspect pads, rotors, and fluid', 180, 12000),
    ('General Inspection', 'Routine multi-point inspection', 90, null)
) as seed(name, description, default_interval_days, default_interval_odometer)
where not exists (
  select 1
  from maintenance_service_types mst
  where lower(mst.name) = lower(seed.name)
);

create table if not exists vehicle_maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_type_id uuid not null references maintenance_service_types(id) on delete restrict,
  interval_days int,
  interval_odometer int,
  last_service_date date,
  last_service_odometer int,
  next_due_date date,
  next_due_odometer int,
  status text not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_maintenance_schedules_status_check check (
    status in ('ACTIVE', 'PAUSED', 'COMPLETED')
  ),
  constraint vehicle_maintenance_schedules_interval_days_check check (
    interval_days is null or interval_days >= 1
  ),
  constraint vehicle_maintenance_schedules_interval_odometer_check check (
    interval_odometer is null or interval_odometer >= 1
  ),
  constraint vehicle_maintenance_schedules_last_service_odometer_check check (
    last_service_odometer is null or last_service_odometer >= 0
  ),
  constraint vehicle_maintenance_schedules_next_due_odometer_check check (
    next_due_odometer is null or next_due_odometer >= 0
  )
);

create index if not exists vehicle_maintenance_schedules_vehicle_id_idx
  on vehicle_maintenance_schedules(vehicle_id);
create index if not exists vehicle_maintenance_schedules_service_type_id_idx
  on vehicle_maintenance_schedules(service_type_id);
create index if not exists vehicle_maintenance_schedules_status_idx
  on vehicle_maintenance_schedules(status);
create index if not exists vehicle_maintenance_schedules_next_due_date_idx
  on vehicle_maintenance_schedules(next_due_date);

-- Preserve V3 compatibility while upgrading maintenance log structure.
create table if not exists vehicle_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_type_id uuid not null references maintenance_service_types(id) on delete restrict,
  service_date date not null,
  service_type text not null default 'General',
  odometer_value int,
  cost_cents int,
  vendor text,
  notes text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vehicle_maintenance_logs_odometer_non_negative check (
    odometer_value is null or odometer_value >= 0
  ),
  constraint vehicle_maintenance_logs_cost_non_negative check (
    cost_cents is null or cost_cents >= 0
  )
);

alter table vehicle_maintenance_logs
  add column if not exists service_type_id uuid references maintenance_service_types(id) on delete restrict;
alter table vehicle_maintenance_logs
  add column if not exists vendor text;
alter table vehicle_maintenance_logs
  add column if not exists created_by_user_id uuid references users(id) on delete set null;
alter table vehicle_maintenance_logs
  add column if not exists service_type text not null default 'General';

update vehicle_maintenance_logs vml
set service_type_id = mst.id
from maintenance_service_types mst
where vml.service_type_id is null
  and lower(coalesce(vml.service_type, '')) = lower(mst.name);

update vehicle_maintenance_logs
set service_type_id = (
  select id
  from maintenance_service_types
  where lower(name) = 'general'
  order by created_at asc
  limit 1
)
where service_type_id is null;

alter table vehicle_maintenance_logs
  alter column service_type_id set not null;

create index if not exists vehicle_maintenance_logs_vehicle_id_idx
  on vehicle_maintenance_logs(vehicle_id);
create index if not exists vehicle_maintenance_logs_service_date_idx
  on vehicle_maintenance_logs(service_date desc);
create index if not exists vehicle_maintenance_logs_service_type_id_idx
  on vehicle_maintenance_logs(service_type_id);

create table if not exists maintenance_reminders (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  schedule_id uuid not null references vehicle_maintenance_schedules(id) on delete cascade,
  remind_at timestamptz not null,
  status text not null default 'PENDING',
  channel text not null default 'EMAIL',
  created_at timestamptz not null default now(),
  constraint maintenance_reminders_status_check check (
    status in ('PENDING', 'SENT', 'CANCELLED')
  ),
  constraint maintenance_reminders_channel_check check (
    channel in ('EMAIL', 'IN_APP')
  )
);

create index if not exists maintenance_reminders_vehicle_id_idx
  on maintenance_reminders(vehicle_id);
create index if not exists maintenance_reminders_schedule_id_idx
  on maintenance_reminders(schedule_id);
create index if not exists maintenance_reminders_status_idx
  on maintenance_reminders(status);
create index if not exists maintenance_reminders_remind_at_idx
  on maintenance_reminders(remind_at);
create unique index if not exists maintenance_reminders_schedule_remind_channel_unique
  on maintenance_reminders(schedule_id, channel, date(remind_at));

create table if not exists vehicle_document_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_document_id uuid not null references vehicle_documents(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (vehicle_document_id, entity_type, entity_id)
);

create index if not exists vehicle_document_links_entity_idx
  on vehicle_document_links(entity_type, entity_id);
create index if not exists vehicle_document_links_vehicle_document_id_idx
  on vehicle_document_links(vehicle_document_id);
