alter table users
  add column if not exists lifecycle_state text not null default 'active';

alter table users
  add column if not exists lifecycle_state_updated_at timestamptz not null default now();

alter table users
  add column if not exists lifecycle_error text;

update users
set lifecycle_state = 'active'
where lifecycle_state is null
   or lifecycle_state not in ('setup_pending', 'active', 'delete_pending_external_cleanup');

update users
set lifecycle_state_updated_at = coalesce(lifecycle_state_updated_at, updated_at, created_at, now())
where lifecycle_state_updated_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_lifecycle_state_check'
  ) then
    alter table users
      add constraint users_lifecycle_state_check
      check (lifecycle_state in ('setup_pending', 'active', 'delete_pending_external_cleanup'));
  end if;
end
$$;
