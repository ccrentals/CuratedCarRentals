create sequence if not exists promo_codes_public_id_seq start 1;

alter table promo_codes
  add column if not exists public_id text;

create or replace function format_public_id(prefix text, n bigint, width int default 6)
returns text
language sql
immutable
as $$
  select prefix || lpad(n::text, width, '0');
$$;

create or replace function assign_promo_codes_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('PR', nextval('promo_codes_public_id_seq'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'promo_codes_assign_public_id'
      and tgrelid = 'promo_codes'::regclass
      and not tgisinternal
  ) then
    create trigger promo_codes_assign_public_id
      before insert on promo_codes
      for each row
      execute function assign_promo_codes_public_id();
  end if;
end $$;

with ordered as (
  select p.id,
         row_number() over (order by p.created_at asc, p.id asc) as rn
  from promo_codes p
  where p.public_id is null
),
base as (
  select coalesce(max((substring(p.public_id from '^PR([0-9]+)$'))::bigint), 0) as max_n
  from promo_codes p
  where p.public_id ~ '^PR[0-9]+$'
)
update promo_codes p
set public_id = format_public_id('PR', base.max_n + ordered.rn)
from ordered, base
where p.id = ordered.id;

do $$
declare
  promo_codes_max bigint;
begin
  select max((substring(public_id from '^PR([0-9]+)$'))::bigint)
    into promo_codes_max
  from promo_codes
  where public_id ~ '^PR[0-9]+$';

  if promo_codes_max is null then
    perform setval('promo_codes_public_id_seq', 1, false);
  else
    perform setval('promo_codes_public_id_seq', promo_codes_max, true);
  end if;
end $$;

alter table promo_codes
  alter column public_id set not null;

create unique index if not exists promo_codes_public_id_unique_idx
  on promo_codes(public_id);
