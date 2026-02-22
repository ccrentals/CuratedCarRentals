-- Messages hardening: shared rate-limit buckets for contact abuse controls

create table if not exists rate_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  subject_key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_limits_count_non_negative check (count >= 0),
  unique (scope, subject_key, window_start)
);

create index if not exists rate_limits_scope_key_window_idx
  on rate_limits(scope, subject_key, window_start desc);

create index if not exists rate_limits_window_start_idx
  on rate_limits(window_start desc);
