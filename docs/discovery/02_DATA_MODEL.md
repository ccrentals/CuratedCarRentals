# 02 Data Model

## Scope
Data model inventory for Quote / Booking / Payment / Calendar / Invoice traceability.

## Primary Schema Sources
- `db/schema.sql`
- `migrations/008_booking_revamp_foundation.sql`
- `migrations/011_quotes.sql`
- `migrations/012_quote_ops.sql`
- `migrations/021_vehicle_maintenance_depreciation_completion.sql`
- `migrations/027_notification_dispatch_log.sql`
- `migrations/028_booking_invoice_documents.sql`

## Runtime Source References
- Quote lifecycle/pricing writes: `src/lib/quotes/adminQuotes.ts`, `src/lib/quotes/quoteOps.ts`, `src/lib/quotes/quotePricing.ts`
- Booking/payment summary and entitlement: `src/lib/payments/pricing.ts`, `src/lib/payments/recalculateBooking.ts`, `src/lib/availability/entitlement.ts`
- Blockout overlap semantics: `src/lib/bookings/bookingBlocking.ts`, `src/app/api/admin/blockouts/route.ts`
- Notification dedupe and invoice ledger usage:
  - `src/lib/notifications/dedupe.ts`
  - `src/lib/invoices/ledger.ts`
  - `src/lib/pdfmonkey.ts`
  - `src/lib/payments/stripeReconcile.ts`

## Entity Table Map

| Entity | Table | Keys / FKs | Status fields | Time window fields | Pricing snapshot fields | Payment fields | Integrity / invariants |
|---|---|---|---|---|---|---|---|
| Quotes | `quotes` | `id` PK; `vehicle_id -> vehicles`; `pickup_location_id/dropoff_location_id -> booking_locations`; `insurance_plan_id -> insurance_plans`; `converted_booking_id -> bookings`; `created_by_admin_user_id -> users` | `status` check: `DRAFT`,`SENT`,`ACCEPTED`,`EXPIRED`,`CONVERTED`,`CANCELLED` | `start_at`,`end_at`,`expires_at`,`created_at`,`updated_at` | `pricing_json`, denormalized totals/deposit/amount_due/rack_price columns | none | `quotes_window_check` (`end_at > start_at`); status check constraint |
| Quote timeline | `quote_events` | `id` PK; `quote_id -> quotes` cascade; `actor_admin_user_id -> users` | `event_type` check: `CREATED`,`UPDATED`,`EMAILED`,`STATUS_CHANGED`,`CONVERTED`,`PDF_GENERATED` | `created_at` | `meta` JSON captures diffs/context | none | Cascade with quote |
| Quote email audit | `quote_emails` | `id` PK; `quote_id -> quotes` cascade | `status` check: `SENT`,`FAILED` | `created_at` | none | provider info in `provider_message_id`,`error` | Immutable send history |
| Bookings | `bookings` | `id` PK; `vehicle_id -> vehicles`; `customer_id -> customers`; `pickup_location_id/dropoff_location_id -> booking_locations`; `archived_by_user_id -> users`; `insurance_plan_id -> insurance_plans` | runtime string `status` (`PENDING_PAYMENT`,`CONFIRMED`,`PICKED_UP`,`RETURNED`,`CANCELLED`, plus overridden semantics) | `start_date`,`end_date`,`start_at`,`end_at`,`pickup_time`,`dropoff_time`,`created_at`,`updated_at`,`archived_at` | `pricing_json` is operational snapshot (totals, payment status, override markers, reminder flags, etc.) | booking-level `payment_option`,`custom_payment_amount_cents` | `bookings_date_check`; payment option check; non-negative checks |
| Payment ledger | `payments` | `id` PK; `booking_id -> bookings` cascade; `deleted_by_user_id -> users` | runtime string `status` (`INITIATED`,`DEPOSIT_PAID`,`FAILED`,`REFUNDED`) | `created_at`,`updated_at`,`deleted_at` | none | `deposit_amount_cents`,`currency`,`provider`,`provider_ref`,`provider_transaction_id`,`metadata_json` | Soft-delete model; multiple rows per booking build payment history |
| Webhook idempotency | `webhook_events` | `id` PK; unique `(provider,event_id)` | none | `received_at` | none | provider delivery identifiers | Prevents duplicate webhook processing |
| Notification dedupe + trace | `notification_dispatch_log` | `id` PK | `status` runtime (`PENDING`,`SENT`,`FAILED`,`SKIPPED`) | `created_at` | none | `channel`,`provider`,`provider_message_id`,`error`,`dedupe_key` | Unique `dedupe_key`; indexes on entity/event dimensions |
| Invoice ledger | `booking_invoice_documents` | `id` PK; `booking_id -> bookings` cascade; `created_by_user_id -> users` | `provider_status` runtime (`SUCCESS`,`FAILED`,`PENDING`,`SKIPPED` etc.) | `generated_at`,`emailed_at` | `payload_hash` uniquely identifies payload version | provider document fields (`provider_document_id`,`download_url`) | Unique `(booking_id,payload_hash)` prevents duplicate docs for identical payload |
| Blockouts | `blockouts` | `id` PK; `vehicle_id -> vehicles`; `created_by -> users`; optional `linked_maintenance_id -> vehicle_maintenance_records` | no standalone status | `start_at`,`end_at`,`created_at`,`updated_at` | none | none | Source semantics (`MANUAL`/`MAINTENANCE`) + linked maintenance integrity |
| Insurance plans | `insurance_plans` | `id` PK; optional `vehicle_id -> vehicles`; `created_by -> users` | `is_enabled`,`is_global_default` | `created_at`,`updated_at` | `price_per_day_cents` | influences quote/booking totals | at most one global default; unique per vehicle |
| Booking locations | `booking_locations` | `id` PK; `created_by -> users` | `is_active`, pickup/dropoff flags | `created_at`,`updated_at` | none | none | label uniqueness (`lower(label)`), role check |
| Booking private files | `booking_private_files` | `id` PK; `booking_id -> bookings`; `created_by_user_id -> users` | `document_type` check (`DRIVERS_LICENSE`,`SIGNATURE`,`OTHER`) | `created_at` | none | none | supports KYC/signature attachment |
| Vehicle documents | `vehicle_documents` | `id` PK; `vehicle_id -> vehicles`; `uploaded_by_user_id -> users`; optional `maintenance_record_id -> vehicle_maintenance_records` | `document_type`, soft archive via `archived_at` | `created_at`,`archived_at` | none | none | document metadata store for admin assets |
| Customers | `customers` | `id` PK; `blocked_by_user_id -> users` | `is_blocked` | `created_at`,`last_booked_at`,`blocked_at`,`birthday` | none | none | booking owner identity/contact/KYC profile |
| Users | `users` | `id` PK; self-ref deactivation actor | `role`,`is_active`, lock/reset flags | `created_at`,`last_login_at`,`deactivated_at`,`password_updated_at` | none | none | RBAC and auth source-of-truth |

## Notable Invariants and Caveats
- Quote status transitions are now guarded in application logic (`src/lib/quotes/lifecycle.ts`), while DB still enforces only status membership.
- Booking and payment statuses remain free-text DB columns with runtime normalization in code.
- `bookings.pricing_json` remains the operational contract for many downstream decisions (entitlement, reminders, reporting, invoice payloads).
- Notification dedupe and invoice traceability are persisted, but not yet exposed as first-class admin read surfaces.

## Missing/Non-Entities (for clarity)
- No dedicated `payment_attempts` table.
- No dedicated `invoices` table outside `booking_invoice_documents` ledger.
- Quote acceptance does not have a separate public acceptance token table/flow today.
