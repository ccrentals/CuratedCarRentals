alter table users
  add column if not exists updated_at timestamptz;

update users
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table users
  alter column updated_at set default now();

alter table users
  alter column updated_at set not null;
