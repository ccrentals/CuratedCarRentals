create sequence if not exists payments_public_id_seq start 1;

alter table payments
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_payments_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('PA', nextval('payments_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'payments_assign_public_id'
      and tgrelid = 'payments'::regclass
      and not tgisinternal
  ) then
    create trigger payments_assign_public_id
      before insert on payments
      for each row
      execute function assign_payments_public_id();
  end if;
end $$;

with ordered as (
  select p.id,
         row_number() over (order by p.created_at asc, p.id asc) as rn
  from payments p
  where p.public_id is null
),
base as (
  select coalesce(max((substring(p.public_id from '^PA([0-9]+)$'))::bigint), 0) as max_n
  from payments p
  where p.public_id ~ '^PA[0-9]+$'
)
update payments p
set public_id = format_public_id('PA', base.max_n + ordered.rn)
from ordered, base
where p.id = ordered.id;

do $$
declare
  payments_max bigint;
begin
  select max((substring(public_id from '^PA([0-9]+)$'))::bigint)
    into payments_max
  from payments
  where public_id ~ '^PA[0-9]+$';

  if payments_max is null then
    perform setval('payments_public_id_seq', 1, false);
  else
    perform setval('payments_public_id_seq', payments_max, true);
  end if;
end $$;

alter table payments
  alter column public_id set not null;

create unique index if not exists payments_public_id_unique_idx
  on payments(public_id);
