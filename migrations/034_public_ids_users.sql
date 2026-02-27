create sequence if not exists users_public_id_seq start 1;

alter table users
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_users_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('UR', nextval('users_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'users_assign_public_id'
      and tgrelid = 'users'::regclass
      and not tgisinternal
  ) then
    create trigger users_assign_public_id
      before insert on users
      for each row
      execute function assign_users_public_id();
  end if;
end $$;

with ordered as (
  select u.id,
         row_number() over (order by u.created_at asc, u.id asc) as rn
  from users u
  where u.public_id is null
),
base as (
  select coalesce(max((substring(u.public_id from '^UR([0-9]+)$'))::bigint), 0) as max_n
  from users u
  where u.public_id ~ '^UR[0-9]+$'
)
update users u
set public_id = format_public_id('UR', base.max_n + ordered.rn)
from ordered, base
where u.id = ordered.id;

do $$
declare
  users_max bigint;
begin
  select max((substring(public_id from '^UR([0-9]+)$'))::bigint)
    into users_max
  from users
  where public_id ~ '^UR[0-9]+$';

  if users_max is null then
    perform setval('users_public_id_seq', 1, false);
  else
    perform setval('users_public_id_seq', users_max, true);
  end if;
end $$;

alter table users
  alter column public_id set not null;

create unique index if not exists users_public_id_unique_idx
  on users(public_id);
