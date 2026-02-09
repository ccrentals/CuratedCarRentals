-- Tracks applied migrations (append-only).
create table if not exists schema_migrations (
  id serial primary key,
  name text not null unique,
  applied_at timestamptz not null default now()
);

