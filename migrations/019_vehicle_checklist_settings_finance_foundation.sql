create table if not exists vehicle_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label text not null,
  default_folder text not null default 'Unsorted',
  required boolean not null default true,
  allow_not_required boolean not null default true,
  expiry_required boolean not null default false,
  expiry_warning_days int,
  is_active boolean not null default true,
  source text not null default 'SETTINGS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_checklist_templates_key_unique unique (key),
  constraint vehicle_checklist_templates_source_check check (
    source in ('SETTINGS', 'MANUAL')
  ),
  constraint vehicle_checklist_templates_expiry_warning_days_check check (
    expiry_warning_days is null or expiry_warning_days >= 0
  )
);

create unique index if not exists vehicle_checklist_templates_label_lower_unique
  on vehicle_checklist_templates(lower(label));
create index if not exists vehicle_checklist_templates_is_active_idx
  on vehicle_checklist_templates(is_active);

alter table vehicle_checklist_items
  add column if not exists template_id uuid references vehicle_checklist_templates(id) on delete set null;
alter table vehicle_checklist_items
  add column if not exists status text;
alter table vehicle_checklist_items
  add column if not exists notes text;
alter table vehicle_checklist_items
  add column if not exists allow_not_required boolean not null default true;
alter table vehicle_checklist_items
  add column if not exists uploaded_at timestamptz;
alter table vehicle_checklist_items
  add column if not exists created_by_user_id uuid references users(id) on delete set null;
alter table vehicle_checklist_items
  add column if not exists updated_by_user_id uuid references users(id) on delete set null;
alter table vehicle_checklist_items
  add column if not exists archived_at timestamptz;

update vehicle_checklist_items
set status = case
  when required = false then 'NOT_REQUIRED'
  when uploaded_document_id is not null then 'OK'
  else 'NOT_OK'
end
where status is null or btrim(status) = '';

update vehicle_checklist_items
set uploaded_at = coalesce(uploaded_at, updated_at, created_at, now())
where uploaded_document_id is not null and uploaded_at is null;

alter table vehicle_checklist_items
  alter column status set default 'NOT_OK';
alter table vehicle_checklist_items
  alter column status set not null;

alter table vehicle_checklist_items
  drop constraint if exists vehicle_checklist_items_status_check;
alter table vehicle_checklist_items
  add constraint vehicle_checklist_items_status_check check (
    status in ('OK', 'NOT_REQUIRED', 'NOT_OK')
  );

alter table vehicle_checklist_items
  drop constraint if exists vehicle_checklist_items_notes_length_check;
alter table vehicle_checklist_items
  add constraint vehicle_checklist_items_notes_length_check check (
    notes is null or char_length(notes) <= 4000
  );

create index if not exists vehicle_checklist_items_template_id_idx
  on vehicle_checklist_items(template_id);
create index if not exists vehicle_checklist_items_vehicle_status_idx
  on vehicle_checklist_items(vehicle_id, status);
create index if not exists vehicle_checklist_items_archived_at_idx
  on vehicle_checklist_items(archived_at);
create index if not exists vehicle_checklist_items_uploaded_document_id_idx
  on vehicle_checklist_items(uploaded_document_id);

create table if not exists vehicle_checklist_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  checklist_item_id uuid not null references vehicle_checklist_items(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vehicle_checklist_events_event_type_check check (
    event_type in (
      'ITEM_CREATED',
      'ITEM_UPDATED',
      'ITEM_DELETED',
      'STATUS_CHANGED',
      'DOCUMENT_LINKED',
      'DOCUMENT_UNLINKED',
      'TEMPLATE_APPLIED'
    )
  )
);

create index if not exists vehicle_checklist_events_vehicle_id_created_idx
  on vehicle_checklist_events(vehicle_id, created_at desc);
create index if not exists vehicle_checklist_events_item_id_created_idx
  on vehicle_checklist_events(checklist_item_id, created_at desc);

create table if not exists vehicle_finance_snapshots (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  snapshot_date date not null,
  revenue_cents int not null default 0,
  expenses_cents int not null default 0,
  repairs_cents int not null default 0,
  net_cents int not null default 0,
  roi_bps int,
  source text not null default 'DERIVED',
  generated_at timestamptz not null default now(),
  constraint vehicle_finance_snapshots_expenses_non_negative check (expenses_cents >= 0),
  constraint vehicle_finance_snapshots_repairs_non_negative check (repairs_cents >= 0),
  constraint vehicle_finance_snapshots_source_check check (
    source in ('DERIVED', 'MANUAL_ADJUSTMENT')
  ),
  unique (vehicle_id, snapshot_date, source)
);

create index if not exists vehicle_finance_snapshots_vehicle_date_idx
  on vehicle_finance_snapshots(vehicle_id, snapshot_date desc);
create index if not exists vehicle_finance_snapshots_snapshot_date_idx
  on vehicle_finance_snapshots(snapshot_date desc);
