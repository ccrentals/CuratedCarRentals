-- Manual payments are soft-deleted (never hard delete).
alter table payments
  add column if not exists deleted_at timestamptz;

alter table payments
  add column if not exists deleted_by_user_id uuid references users(id) on delete set null;

alter table payments
  add column if not exists deleted_reason text;

create index if not exists payments_deleted_at_idx on payments(deleted_at);

