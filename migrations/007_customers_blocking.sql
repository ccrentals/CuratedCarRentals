-- Add customer blocking fields for admin controls.
alter table if exists customers
  add column if not exists is_blocked boolean not null default false;

alter table if exists customers
  add column if not exists blocked_at timestamptz;

alter table if exists customers
  add column if not exists blocked_by_user_id uuid references users(id) on delete set null;

alter table if exists customers
  add column if not exists blocked_reason text;
