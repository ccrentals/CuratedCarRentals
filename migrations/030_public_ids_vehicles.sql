create sequence if not exists vehicles_public_id_seq start 1;

alter table vehicles
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_vehicles_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('VE', nextval('vehicles_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'vehicles_assign_public_id'
      and tgrelid = 'vehicles'::regclass
      and not tgisinternal
  ) then
    create trigger vehicles_assign_public_id
      before insert on vehicles
      for each row
      execute function assign_vehicles_public_id();
  end if;
end $$;

with ordered as (
  select v.id,
         row_number() over (order by v.created_at asc, v.id asc) as rn
  from vehicles v
  where v.public_id is null
),
base as (
  select coalesce(max((substring(v.public_id from '^VE([0-9]+)$'))::bigint), 0) as max_n
  from vehicles v
  where v.public_id ~ '^VE[0-9]+$'
)
update vehicles v
set public_id = format_public_id('VE', base.max_n + ordered.rn)
from ordered, base
where v.id = ordered.id;

do $$
declare
  vehicles_max bigint;
begin
  select max((substring(public_id from '^VE([0-9]+)$'))::bigint)
    into vehicles_max
  from vehicles
  where public_id ~ '^VE[0-9]+$';

  if vehicles_max is null then
    perform setval('vehicles_public_id_seq', 1, false);
  else
    perform setval('vehicles_public_id_seq', vehicles_max, true);
  end if;
end $$;

alter table vehicles
  alter column public_id set not null;

create unique index if not exists vehicles_public_id_unique_idx
  on vehicles(public_id);
