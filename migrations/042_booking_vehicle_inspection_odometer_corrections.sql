alter table booking_vehicle_inspections
  add column if not exists odometer_corrected_from_value int,
  add column if not exists odometer_correction_reason text,
  add column if not exists odometer_corrected_by_user_id uuid references users(id) on delete set null,
  add column if not exists odometer_corrected_at timestamptz;

alter table booking_vehicle_inspections
  drop constraint if exists booking_vehicle_inspections_corrected_odometer_check;
alter table booking_vehicle_inspections
  add constraint booking_vehicle_inspections_corrected_odometer_check check (
    odometer_corrected_from_value is null or odometer_corrected_from_value >= 0
  );

alter table booking_vehicle_inspections
  drop constraint if exists booking_vehicle_inspections_correction_reason_length_check;
alter table booking_vehicle_inspections
  add constraint booking_vehicle_inspections_correction_reason_length_check check (
    odometer_correction_reason is null or char_length(odometer_correction_reason) <= 1000
  );

create index if not exists booking_vehicle_inspections_corrected_at_idx
  on booking_vehicle_inspections(odometer_corrected_at);

create index if not exists booking_vehicle_inspections_corrected_by_user_id_idx
  on booking_vehicle_inspections(odometer_corrected_by_user_id);
