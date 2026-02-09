-- User management fields: usernames, activation/deactivation, first-login password change, and login metadata.
alter table users
  add column if not exists username text;

-- Optional: make username unique case-insensitively by storing lower(username) in a unique index.
-- Note: expression indexes are supported in Postgres; keep it simple and safe.
create unique index if not exists users_username_lower_uq on users (lower(username)) where username is not null;

alter table users
  add column if not exists full_name text;

alter table users
  add column if not exists is_active boolean not null default true;

alter table users
  add column if not exists deactivated_at timestamptz;

alter table users
  add column if not exists deactivated_by_user_id uuid references users(id) on delete set null;

alter table users
  add column if not exists deactivated_reason text;

alter table users
  add column if not exists must_change_password boolean not null default false;

alter table users
  add column if not exists temp_password_expires_at timestamptz;

alter table users
  add column if not exists password_updated_at timestamptz;

alter table users
  add column if not exists last_login_at timestamptz;

alter table users
  add column if not exists last_login_ip text;

create index if not exists users_is_active_idx on users(is_active);
create index if not exists users_deactivated_at_idx on users(deactivated_at);
create index if not exists users_locked_at_idx on users(locked_at);

