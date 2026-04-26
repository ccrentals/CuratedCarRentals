create table if not exists email_dispatches (
  id uuid primary key default gen_random_uuid(),
  entity_type text,
  entity_id uuid,
  entity_public_id text,
  email_type text not null,
  channel text not null default 'email',
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'PENDING',
  to_email text not null,
  subject text not null,
  recipient_name text,
  triggered_by_user_id uuid references users(id) on delete set null,
  trigger_source text not null,
  related_transaction_type text,
  related_transaction_id text,
  error text,
  provider_error_category text,
  provider_error_reason text,
  manual_resend_allowed boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_dispatches_status_check
    check (status in ('PENDING', 'SENT', 'FAILED', 'BOUNCED', 'DELIVERY_ISSUE', 'SKIPPED')),
  constraint email_dispatches_provider_check check (provider in ('resend'))
);

create index if not exists email_dispatches_created_idx
  on email_dispatches(created_at desc);

create index if not exists email_dispatches_status_created_idx
  on email_dispatches(status, created_at desc);

create index if not exists email_dispatches_email_type_created_idx
  on email_dispatches(email_type, created_at desc);

create index if not exists email_dispatches_entity_idx
  on email_dispatches(entity_type, entity_id, created_at desc);

create index if not exists email_dispatches_recipient_idx
  on email_dispatches(lower(to_email), created_at desc);

create index if not exists email_dispatches_provider_message_idx
  on email_dispatches(provider, provider_message_id)
  where provider_message_id is not null;

create table if not exists email_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  email_dispatch_id uuid not null references email_dispatches(id) on delete cascade,
  source text not null,
  event_type text not null,
  status text,
  occurred_at timestamptz not null default now(),
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_dispatch_events_dispatch_occurred_idx
  on email_dispatch_events(email_dispatch_id, occurred_at desc, created_at desc);
