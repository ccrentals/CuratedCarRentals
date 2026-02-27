create sequence if not exists bookings_public_id_seq start 1;
create sequence if not exists quotes_public_id_seq start 1;

alter table bookings
  add column if not exists public_id text;

alter table quotes
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_bookings_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('B', nextval('bookings_public_id_seq'));
  end if;
  return new;
end;
$$;

create or replace function assign_quotes_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('Q', nextval('quotes_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'bookings_assign_public_id'
      and tgrelid = 'bookings'::regclass
      and not tgisinternal
  ) then
    create trigger bookings_assign_public_id
      before insert on bookings
      for each row
      execute function assign_bookings_public_id();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'quotes_assign_public_id'
      and tgrelid = 'quotes'::regclass
      and not tgisinternal
  ) then
    create trigger quotes_assign_public_id
      before insert on quotes
      for each row
      execute function assign_quotes_public_id();
  end if;
end $$;

with ordered as (
  select b.id,
         row_number() over (order by b.created_at asc, b.id asc) as rn
  from bookings b
  where b.public_id is null
),
base as (
  select coalesce(max((substring(b.public_id from '^B([0-9]+)$'))::bigint), 0) as max_n
  from bookings b
  where b.public_id ~ '^B[0-9]+$'
)
update bookings b
set public_id = format_public_id('B', base.max_n + ordered.rn)
from ordered, base
where b.id = ordered.id;

with ordered as (
  select q.id,
         row_number() over (order by q.created_at asc, q.id asc) as rn
  from quotes q
  where q.public_id is null
),
base as (
  select coalesce(max((substring(q.public_id from '^Q([0-9]+)$'))::bigint), 0) as max_n
  from quotes q
  where q.public_id ~ '^Q[0-9]+$'
)
update quotes q
set public_id = format_public_id('Q', base.max_n + ordered.rn)
from ordered, base
where q.id = ordered.id;

do $$
declare
  bookings_max bigint;
  quotes_max bigint;
begin
  select max((substring(public_id from '^B([0-9]+)$'))::bigint)
    into bookings_max
  from bookings
  where public_id ~ '^B[0-9]+$';

  if bookings_max is null then
    perform setval('bookings_public_id_seq', 1, false);
  else
    perform setval('bookings_public_id_seq', bookings_max, true);
  end if;

  select max((substring(public_id from '^Q([0-9]+)$'))::bigint)
    into quotes_max
  from quotes
  where public_id ~ '^Q[0-9]+$';

  if quotes_max is null then
    perform setval('quotes_public_id_seq', 1, false);
  else
    perform setval('quotes_public_id_seq', quotes_max, true);
  end if;
end $$;

alter table bookings
  alter column public_id set not null;

alter table quotes
  alter column public_id set not null;

create unique index if not exists bookings_public_id_unique_idx
  on bookings(public_id);

create unique index if not exists quotes_public_id_unique_idx
  on quotes(public_id);
