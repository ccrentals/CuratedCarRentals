alter table vehicles
  add column if not exists deleted_at timestamptz;

create index if not exists vehicles_deleted_at_idx
  on vehicles(deleted_at);
