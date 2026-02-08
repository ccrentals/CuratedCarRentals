-- Seed data for Curated Car Rentals

insert into vehicles (make, model, year, daily_rate_cents, deposit_cents, status, features_json, image_urls_json)
values (
  'Toyota',
  'Yaris',
  2020,
  9500,
  3000,
  'ACTIVE',
  '["Automatic", "Air Conditioning", "Bluetooth"]',
  '["/cars/real/toyota-yaris-2020-1.jpg"]'
);

-- Admin login (replace with a bcrypt hash before use)
-- Example: generate with Node using bcryptjs hash
insert into users (email, password_hash, role)
values ('admin@curatedcarrentals.com', 'REPLACE_WITH_BCRYPT_HASH', 'admin')
on conflict (email) do nothing;
