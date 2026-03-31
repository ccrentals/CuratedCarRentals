-- Canonical booking-location config (phase 2)

alter table booking_locations
  add column if not exists location_type_key text;

alter table booking_locations
  add column if not exists display_label_pickup text;

alter table booking_locations
  add column if not exists display_label_dropoff text;

alter table booking_locations
  add column if not exists applies_to_pickup boolean;

alter table booking_locations
  add column if not exists applies_to_dropoff boolean;

alter table booking_locations
  add column if not exists field_schema_json jsonb;

update booking_locations
set
  applies_to_pickup = coalesce(applies_to_pickup, allow_pickup, true),
  applies_to_dropoff = coalesce(applies_to_dropoff, allow_dropoff, true)
where applies_to_pickup is null
   or applies_to_dropoff is null;

insert into booking_locations (
  label,
  allow_pickup,
  allow_dropoff,
  applies_to_pickup,
  applies_to_dropoff,
  is_active,
  sort_order,
  location_type_key,
  display_label_pickup,
  display_label_dropoff,
  field_schema_json
)
select
  '168 1/2 Old Hope Road, Kingston Jamaica',
  true,
  true,
  true,
  true,
  true,
  1,
  'OFFICE',
  '168 1/2 Old Hope Road, Kingston Jamaica',
  '168 1/2 Old Hope Road, Kingston Jamaica',
  '[]'::jsonb
where not exists (
  select 1 from booking_locations where location_type_key = 'OFFICE'
);

insert into booking_locations (
  label,
  allow_pickup,
  allow_dropoff,
  applies_to_pickup,
  applies_to_dropoff,
  is_active,
  sort_order,
  location_type_key,
  display_label_pickup,
  display_label_dropoff,
  field_schema_json
)
select
  'Norman Manley Airport',
  true,
  true,
  true,
  true,
  true,
  2,
  'AIRPORT',
  'Norman Manley Airport',
  'Norman Manley Airport',
  jsonb_build_array(
    jsonb_build_object('key', 'flight_date', 'label', 'Flight Arrival Date', 'input_type', 'date', 'required', false, 'applies_to', 'pickup', 'default_source', 'pickup_date'),
    jsonb_build_object('key', 'flight_time', 'label', 'Flight Arrival Time', 'input_type', 'time', 'required', false, 'applies_to', 'pickup', 'default_source', 'pickup_time'),
    jsonb_build_object('key', 'flight_number', 'label', 'Flight Number', 'input_type', 'text', 'required', false, 'applies_to', 'pickup', 'default_source', null),
    jsonb_build_object('key', 'airline', 'label', 'Airline', 'input_type', 'text', 'required', false, 'applies_to', 'pickup', 'default_source', null),
    jsonb_build_object('key', 'flight_date', 'label', 'Flight Departure Date', 'input_type', 'date', 'required', false, 'applies_to', 'dropoff', 'default_source', 'dropoff_date'),
    jsonb_build_object('key', 'flight_time', 'label', 'Flight Departure Time', 'input_type', 'time', 'required', false, 'applies_to', 'dropoff', 'default_source', 'dropoff_time'),
    jsonb_build_object('key', 'flight_number', 'label', 'Flight Number', 'input_type', 'text', 'required', false, 'applies_to', 'dropoff', 'default_source', null),
    jsonb_build_object('key', 'airline', 'label', 'Airline', 'input_type', 'text', 'required', false, 'applies_to', 'dropoff', 'default_source', null)
  )
where not exists (
  select 1 from booking_locations where location_type_key = 'AIRPORT'
);

insert into booking_locations (
  label,
  allow_pickup,
  allow_dropoff,
  applies_to_pickup,
  applies_to_dropoff,
  is_active,
  sort_order,
  location_type_key,
  display_label_pickup,
  display_label_dropoff,
  field_schema_json
)
select
  'Custom Address',
  true,
  true,
  true,
  true,
  true,
  3,
  'CUSTOM_ADDRESS',
  'Pick up Address',
  'Return Address',
  jsonb_build_array(
    jsonb_build_object('key', 'address', 'label', 'Pick up Address', 'input_type', 'text', 'required', true, 'applies_to', 'pickup', 'default_source', null),
    jsonb_build_object('key', 'address', 'label', 'Return Address', 'input_type', 'text', 'required', true, 'applies_to', 'dropoff', 'default_source', null)
  )
where not exists (
  select 1 from booking_locations where location_type_key = 'CUSTOM_ADDRESS'
);

with canonical as (
  select
    (
      select id
      from booking_locations
      where location_type_key = 'OFFICE'
      order by sort_order asc, created_at asc, id asc
      limit 1
    ) as office_id,
    (
      select id
      from booking_locations
      where location_type_key = 'AIRPORT'
      order by sort_order asc, created_at asc, id asc
      limit 1
    ) as airport_id,
    (
      select id
      from booking_locations
      where location_type_key = 'CUSTOM_ADDRESS'
      order by sort_order asc, created_at asc, id asc
      limit 1
    ) as custom_id
)
update bookings b
set
  pickup_location_id = case
    when lower(trim(coalesce(b.pickup_location_text_snapshot, b.pickup_location, ''))) = lower('168 1/2 Old Hope Road, Kingston Jamaica') then canonical.office_id
    when lower(trim(coalesce(b.pickup_location_text_snapshot, b.pickup_location, ''))) in (
      lower('Norman Manley Airport'),
      lower('Kingston International Airport')
    ) then canonical.airport_id
    when nullif(trim(coalesce(b.pickup_location_text_snapshot, b.pickup_location, '')), '') is not null then canonical.custom_id
    else null
  end,
  dropoff_location_id = case
    when lower(trim(coalesce(b.dropoff_location_text_snapshot, b.dropoff_location, ''))) = lower('168 1/2 Old Hope Road, Kingston Jamaica') then canonical.office_id
    when lower(trim(coalesce(b.dropoff_location_text_snapshot, b.dropoff_location, ''))) in (
      lower('Norman Manley Airport'),
      lower('Kingston International Airport')
    ) then canonical.airport_id
    when nullif(trim(coalesce(b.dropoff_location_text_snapshot, b.dropoff_location, '')), '') is not null then canonical.custom_id
    else null
  end
from canonical;

with canonical as (
  select
    (
      select id
      from booking_locations
      where location_type_key = 'OFFICE'
      order by sort_order asc, created_at asc, id asc
      limit 1
    ) as office_id,
    (
      select id
      from booking_locations
      where location_type_key = 'AIRPORT'
      order by sort_order asc, created_at asc, id asc
      limit 1
    ) as airport_id,
    (
      select id
      from booking_locations
      where location_type_key = 'CUSTOM_ADDRESS'
      order by sort_order asc, created_at asc, id asc
      limit 1
    ) as custom_id
)
update quotes q
set
  pickup_location_id = case
    when lower(trim(coalesce(q.pickup_location_text, ''))) = lower('168 1/2 Old Hope Road, Kingston Jamaica') then canonical.office_id
    when lower(trim(coalesce(q.pickup_location_text, ''))) in (
      lower('Norman Manley Airport'),
      lower('Kingston International Airport')
    ) then canonical.airport_id
    when nullif(trim(coalesce(q.pickup_location_text, '')), '') is not null then canonical.custom_id
    else null
  end,
  dropoff_location_id = case
    when lower(trim(coalesce(q.dropoff_location_text, ''))) = lower('168 1/2 Old Hope Road, Kingston Jamaica') then canonical.office_id
    when lower(trim(coalesce(q.dropoff_location_text, ''))) in (
      lower('Norman Manley Airport'),
      lower('Kingston International Airport')
    ) then canonical.airport_id
    when nullif(trim(coalesce(q.dropoff_location_text, '')), '') is not null then canonical.custom_id
    else null
  end
from canonical;

update booking_locations
set
  label = '168 1/2 Old Hope Road, Kingston Jamaica',
  allow_pickup = true,
  allow_dropoff = true,
  applies_to_pickup = true,
  applies_to_dropoff = true,
  is_active = true,
  sort_order = 1,
  display_label_pickup = '168 1/2 Old Hope Road, Kingston Jamaica',
  display_label_dropoff = '168 1/2 Old Hope Road, Kingston Jamaica',
  field_schema_json = '[]'::jsonb
where location_type_key = 'OFFICE';

update booking_locations
set
  label = 'Norman Manley Airport',
  allow_pickup = true,
  allow_dropoff = true,
  applies_to_pickup = true,
  applies_to_dropoff = true,
  is_active = true,
  sort_order = 2,
  display_label_pickup = 'Norman Manley Airport',
  display_label_dropoff = 'Norman Manley Airport',
  field_schema_json = jsonb_build_array(
    jsonb_build_object('key', 'flight_date', 'label', 'Flight Arrival Date', 'input_type', 'date', 'required', false, 'applies_to', 'pickup', 'default_source', 'pickup_date'),
    jsonb_build_object('key', 'flight_time', 'label', 'Flight Arrival Time', 'input_type', 'time', 'required', false, 'applies_to', 'pickup', 'default_source', 'pickup_time'),
    jsonb_build_object('key', 'flight_number', 'label', 'Flight Number', 'input_type', 'text', 'required', false, 'applies_to', 'pickup', 'default_source', null),
    jsonb_build_object('key', 'airline', 'label', 'Airline', 'input_type', 'text', 'required', false, 'applies_to', 'pickup', 'default_source', null),
    jsonb_build_object('key', 'flight_date', 'label', 'Flight Departure Date', 'input_type', 'date', 'required', false, 'applies_to', 'dropoff', 'default_source', 'dropoff_date'),
    jsonb_build_object('key', 'flight_time', 'label', 'Flight Departure Time', 'input_type', 'time', 'required', false, 'applies_to', 'dropoff', 'default_source', 'dropoff_time'),
    jsonb_build_object('key', 'flight_number', 'label', 'Flight Number', 'input_type', 'text', 'required', false, 'applies_to', 'dropoff', 'default_source', null),
    jsonb_build_object('key', 'airline', 'label', 'Airline', 'input_type', 'text', 'required', false, 'applies_to', 'dropoff', 'default_source', null)
  )
where location_type_key = 'AIRPORT';

update booking_locations
set
  label = 'Custom Address',
  allow_pickup = true,
  allow_dropoff = true,
  applies_to_pickup = true,
  applies_to_dropoff = true,
  is_active = true,
  sort_order = 3,
  display_label_pickup = 'Pick up Address',
  display_label_dropoff = 'Return Address',
  field_schema_json = jsonb_build_array(
    jsonb_build_object('key', 'address', 'label', 'Pick up Address', 'input_type', 'text', 'required', true, 'applies_to', 'pickup', 'default_source', null),
    jsonb_build_object('key', 'address', 'label', 'Return Address', 'input_type', 'text', 'required', true, 'applies_to', 'dropoff', 'default_source', null)
  )
where location_type_key = 'CUSTOM_ADDRESS';

delete from booking_locations
where location_type_key is null
   or location_type_key not in ('OFFICE', 'AIRPORT', 'CUSTOM_ADDRESS');

drop index if exists booking_locations_label_lower_unique_idx;

alter table booking_locations
  alter column location_type_key set not null;

alter table booking_locations
  alter column display_label_pickup set not null;

alter table booking_locations
  alter column display_label_dropoff set not null;

alter table booking_locations
  alter column applies_to_pickup set not null;

alter table booking_locations
  alter column applies_to_dropoff set not null;

alter table booking_locations
  alter column field_schema_json set default '[]'::jsonb;

update booking_locations
set field_schema_json = '[]'::jsonb
where field_schema_json is null;

alter table booking_locations
  alter column field_schema_json set not null;

create unique index if not exists booking_locations_location_type_key_unique_idx
  on booking_locations(location_type_key);

create index if not exists booking_locations_active_sort_type_idx
  on booking_locations(is_active, sort_order, location_type_key);
