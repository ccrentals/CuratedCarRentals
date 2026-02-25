-- Optional Clerk identity mapping for staged admin auth migration.
alter table users
  add column if not exists clerk_user_id text;

create unique index if not exists users_clerk_user_id_uq
  on users (clerk_user_id)
  where clerk_user_id is not null;
