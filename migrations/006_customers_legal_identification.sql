-- Customer legal identification fields
alter table customers
  add column if not exists legal_id_type text;

alter table customers
  add column if not exists legal_id_number text;

alter table customers
  add column if not exists legal_id_image_url text;

create index if not exists customers_legal_id_number_idx on customers(legal_id_number);

