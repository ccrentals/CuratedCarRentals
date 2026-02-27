create table if not exists notification_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  dedupe_key text not null,
  channel text not null default 'email',
  provider text,
  provider_message_id text,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_dispatch_log_dedupe_key_unique
  on notification_dispatch_log(dedupe_key);

create index if not exists notification_dispatch_log_entity_idx
  on notification_dispatch_log(entity_type, entity_id);

create index if not exists notification_dispatch_log_event_created_idx
  on notification_dispatch_log(event_type, created_at desc);
