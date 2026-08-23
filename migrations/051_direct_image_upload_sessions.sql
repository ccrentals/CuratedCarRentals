create table if not exists admin_image_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  storage_scope text not null,
  entity_type text not null,
  entity_id uuid,
  storage_key text not null unique,
  original_file_name text not null,
  mime_type text not null,
  expected_bytes bigint not null,
  checksum_sha256 text not null,
  received_bytes bigint,
  received_checksum_sha256 text,
  status text not null default 'AUTHORIZED',
  context_json jsonb not null default '{}'::jsonb,
  final_result_json jsonb,
  expires_at timestamptz not null,
  started_at timestamptz,
  uploaded_at timestamptz,
  finalized_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_image_upload_sessions_purpose_check check (
    purpose in ('VEHICLE_GALLERY', 'LANDING_CONTENT', 'CUSTOMER_LEGAL_ID', 'INSPECTION_IMAGE')
  ),
  constraint admin_image_upload_sessions_scope_check check (storage_scope in ('public', 'private')),
  constraint admin_image_upload_sessions_status_check check (
    status in ('AUTHORIZED', 'UPLOADING', 'UPLOADED', 'FINALIZED', 'FAILED', 'CLEANUP_PENDING', 'EXPIRED')
  ),
  constraint admin_image_upload_sessions_expected_bytes_check check (
    expected_bytes > 0 and expected_bytes <= 52428800
  ),
  constraint admin_image_upload_sessions_checksum_check check (
    checksum_sha256 ~ '^[A-F0-9]{64}$'
  ),
  constraint admin_image_upload_sessions_received_checksum_check check (
    received_checksum_sha256 is null or received_checksum_sha256 ~ '^[A-F0-9]{64}$'
  )
);

create index if not exists admin_image_upload_sessions_user_created_idx
  on admin_image_upload_sessions(user_id, created_at desc);

create index if not exists admin_image_upload_sessions_cleanup_idx
  on admin_image_upload_sessions(status, expires_at);
