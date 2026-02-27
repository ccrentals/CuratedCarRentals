update bookings
set public_id = 'BK' || substring(public_id from 2)
where public_id ~ '^B[0-9]{6,}$';

update quotes
set public_id = 'QU' || substring(public_id from 2)
where public_id ~ '^Q[0-9]{6,}$';

create or replace function assign_bookings_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null or btrim(new.public_id) = '' then
    new.public_id := format_public_id('BK', nextval('bookings_public_id_seq'));
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
    new.public_id := format_public_id('QU', nextval('quotes_public_id_seq'));
  end if;
  return new;
end;
$$;
