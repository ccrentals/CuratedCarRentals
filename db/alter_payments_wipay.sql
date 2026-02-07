-- Add WiPay metadata columns (safe to run multiple times)

alter table payments
  add column if not exists provider_transaction_id text;

alter table payments
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;
