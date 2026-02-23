-- Quotes ops: PDF events + email logs

alter table quote_events
  drop constraint if exists quote_events_event_type_check;

alter table quote_events
  add constraint quote_events_event_type_check check (
    event_type in ('CREATED', 'UPDATED', 'EMAILED', 'STATUS_CHANGED', 'CONVERTED', 'PDF_GENERATED')
  );

create table if not exists quote_emails (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  to_email text not null,
  subject text not null,
  status text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  constraint quote_emails_status_check check (status in ('SENT', 'FAILED'))
);

create index if not exists quote_emails_quote_created_idx
  on quote_emails(quote_id, created_at desc);
create index if not exists quote_emails_status_created_idx
  on quote_emails(status, created_at desc);
create index if not exists quote_emails_to_email_lower_idx
  on quote_emails(lower(to_email));
