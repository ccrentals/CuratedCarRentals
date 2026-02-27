create table if not exists booking_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  source text not null default 'PDFMONKEY',
  template_id text,
  provider_document_id text,
  provider_status text,
  download_url text,
  payload_hash text not null,
  generated_at timestamptz not null default now(),
  emailed_at timestamptz,
  last_error text,
  created_by_user_id uuid references users(id) on delete set null
);

create index if not exists booking_invoice_documents_booking_generated_idx
  on booking_invoice_documents(booking_id, generated_at desc);

create unique index if not exists booking_invoice_documents_booking_payload_unique
  on booking_invoice_documents(booking_id, payload_hash);
