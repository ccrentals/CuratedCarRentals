create sequence if not exists customers_public_id_seq start 1;

alter table customers
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_customers_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('CU', nextval('customers_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'customers_assign_public_id'
      and tgrelid = 'customers'::regclass
      and not tgisinternal
  ) then
    create trigger customers_assign_public_id
      before insert on customers
      for each row
      execute function assign_customers_public_id();
  end if;
end $$;

with ordered as (
  select c.id,
         row_number() over (order by c.created_at asc, c.id asc) as rn
  from customers c
  where c.public_id is null
),
base as (
  select coalesce(max((substring(c.public_id from '^CU([0-9]+)$'))::bigint), 0) as max_n
  from customers c
  where c.public_id ~ '^CU[0-9]+$'
)
update customers c
set public_id = format_public_id('CU', base.max_n + ordered.rn)
from ordered, base
where c.id = ordered.id;

do $$
declare
  customers_max bigint;
begin
  select max((substring(public_id from '^CU([0-9]+)$'))::bigint)
    into customers_max
  from customers
  where public_id ~ '^CU[0-9]+$';

  if customers_max is null then
    perform setval('customers_public_id_seq', 1, false);
  else
    perform setval('customers_public_id_seq', customers_max, true);
  end if;
end $$;

alter table customers
  alter column public_id set not null;

create unique index if not exists customers_public_id_unique_idx
  on customers(public_id);
