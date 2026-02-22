-- Public contact form submissions

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  message text not null,
  status text not null default 'NEW',
  read_at timestamptz,
  read_by_user_id uuid references users(id) on delete set null,
  source text not null default 'contact_page',
  constraint contact_messages_status_check check (status in ('NEW', 'READ', 'ARCHIVED'))
);

create index if not exists contact_messages_status_created_idx
  on contact_messages(status, created_at desc);
create index if not exists contact_messages_created_idx
  on contact_messages(created_at desc);
