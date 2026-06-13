alter table if exists booking_private_files
  add column if not exists customer_id uuid references customers(id) on delete cascade;

update booking_private_files bpf
set customer_id = b.customer_id
from bookings b
where bpf.booking_id = b.id
  and bpf.customer_id is null;

create or replace function set_booking_private_file_customer_id()
returns trigger
language plpgsql
as $$
begin
  if new.customer_id is null and new.booking_id is not null then
    select customer_id
    into new.customer_id
    from bookings
    where id = new.booking_id;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_private_files_customer_owner on booking_private_files;
create trigger booking_private_files_customer_owner
before insert or update of booking_id, customer_id
on booking_private_files
for each row
execute function set_booking_private_file_customer_id();

alter table if exists booking_private_files
  alter column booking_id drop not null;

alter table if exists booking_private_files
  alter column customer_id set not null;

create index if not exists booking_private_files_customer_id_idx
  on booking_private_files(customer_id);

create index if not exists booking_private_files_customer_document_created_idx
  on booking_private_files(customer_id, document_type, created_at desc);
