-- Store identification expiry dates on the customer profile so they can be
-- maintained independently from the booking-time document snapshot.

alter table if exists customers
  add column if not exists drivers_license_expiration_date date;

alter table if exists customers
  add column if not exists legal_id_expiration_date date;
