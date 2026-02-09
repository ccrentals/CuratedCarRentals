-- Booking archive fields (hide by default in main list).
alter table bookings
  add column if not exists archived_at timestamptz;

alter table bookings
  add column if not exists archived_by_user_id uuid references users(id) on delete set null;

alter table bookings
  add column if not exists archived_reason text;

create index if not exists bookings_archived_at_idx on bookings(archived_at);

