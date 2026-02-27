alter table vehicles
  add column if not exists seat_count int;

alter table vehicles
  drop constraint if exists vehicles_seat_count_range;

alter table vehicles
  add constraint vehicles_seat_count_range check (
    seat_count is null or (seat_count >= 1 and seat_count <= 60)
  );
