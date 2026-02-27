create sequence if not exists vehicle_maintenance_records_public_id_seq start 1;

alter table vehicle_maintenance_records
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_vehicle_maintenance_records_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('ME', nextval('vehicle_maintenance_records_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'vehicle_maintenance_records_assign_public_id'
      and tgrelid = 'vehicle_maintenance_records'::regclass
      and not tgisinternal
  ) then
    create trigger vehicle_maintenance_records_assign_public_id
      before insert on vehicle_maintenance_records
      for each row
      execute function assign_vehicle_maintenance_records_public_id();
  end if;
end $$;

with ordered as (
  select r.id,
         row_number() over (order by r.created_at asc, r.id asc) as rn
  from vehicle_maintenance_records r
  where r.public_id is null
),
base as (
  select coalesce(max((substring(r.public_id from '^ME([0-9]+)$'))::bigint), 0) as max_n
  from vehicle_maintenance_records r
  where r.public_id ~ '^ME[0-9]+$'
)
update vehicle_maintenance_records r
set public_id = format_public_id('ME', base.max_n + ordered.rn)
from ordered, base
where r.id = ordered.id;

do $$
declare
  maintenance_max bigint;
begin
  select max((substring(public_id from '^ME([0-9]+)$'))::bigint)
    into maintenance_max
  from vehicle_maintenance_records
  where public_id ~ '^ME[0-9]+$';

  if maintenance_max is null then
    perform setval('vehicle_maintenance_records_public_id_seq', 1, false);
  else
    perform setval('vehicle_maintenance_records_public_id_seq', maintenance_max, true);
  end if;
end $$;

alter table vehicle_maintenance_records
  alter column public_id set not null;

create unique index if not exists vehicle_maintenance_records_public_id_unique_idx
  on vehicle_maintenance_records(public_id);
