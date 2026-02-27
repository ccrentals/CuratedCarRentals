# 05 Gaps and Risks

## Scope
Prioritized remaining gaps in Quote / Booking / Payments / Calendar lifecycle after recent hardening.

Each item includes:
- observed behavior (with file refs)
- risk
- minimal fix (no overhaul)
- test needed

## High Priority

| Gap | Observed behavior (code paths) | Risk | Minimal fix | Test needed |
|---|---|---|---|---|
| Public booking create has no request idempotency key | `POST /api/public/bookings` creates rows directly and can be retried without idempotency token (`src/app/api/public/bookings/route.ts`). | Duplicate customer bookings and duplicate “booking created” sends on retries/double-submit. | Add idempotency key support + lightweight idempotency table keyed by `(vehicle/window/customer/key)`. | API test: same payload+key returns same booking once. |
| Public booking availability check is not lock-scoped in booking create transaction | Availability is checked before insert, but there is no per-vehicle lock and in-transaction overlap recheck at create time (`src/app/api/public/bookings/route.ts`, `src/lib/publicVehicles.ts`). | Two concurrent submits can both pass and produce competing `PENDING_PAYMENT` bookings. | Add advisory lock in create transaction and re-check overlap immediately before insert. | Concurrency integration test with parallel creates on same vehicle/window. |
| Booking/payment lifecycle still depends on free-text status columns | `bookings.status` and `payments.status` are interpreted across many modules (`src/lib/availability/entitlement.ts`, `src/lib/payments/pricing.ts`, `src/lib/bookings/adminBookingsList.ts`). | Typos/non-standard statuses can silently break reports, reminders, and occupancy behavior. | Add DB check constraints (or enums) with compatibility migration and normalization pass. | Migration regression tests + API status transition tests. |

## Medium Priority

| Gap | Observed behavior (code paths) | Risk | Minimal fix | Test needed |
|---|---|---|---|---|
| Pricing snapshot contract is still convention-based JSON | `pricing_json` is written/read by multiple modules (`src/lib/quotes/quotePricing.ts`, `src/lib/payments/pricing.ts`, `src/lib/payments/recalculateBooking.ts`, `src/lib/reports/adminReports.ts`). | Drift in key names/defaults causes inconsistent totals/status interpretation across surfaces. | Add shared runtime validator/normalizer for `pricing_json` at write and read boundaries. | Unit tests for malformed/missing snapshot keys; integration across quote->booking->payment. |
| Notification dedupe is partial, not universal | High-risk paths use `notification_dispatch_log` (`src/lib/payments/wipayReconcile.ts`, `src/app/api/admin/bookings/[id]/resend-email/route.ts`), but quote emails and cron reminders use separate dedupe patterns (`quote_emails`, pricing JSON reminder stamps). | Duplicate/missed sends remain possible across mixed trigger paths. | Standardize all email sends through one dedupe helper + consistent event taxonomy. | Integration tests for duplicate-trigger scenarios (return+webhook+cron rerun). |
| Invoice ledger exists but lacks first-class retrieval surface | Ledger rows are written in invoice payload and PDF generation paths (`src/app/api/admin/bookings/[id]/invoice-payload/route.ts`, `src/lib/pdfmonkey.ts`), but there is no dedicated admin endpoint/UI for invoice history. | Ops cannot quickly inspect document lineage/status/failures without DB access. | Add `GET /api/admin/bookings/:id/invoices` read endpoint and small admin detail panel. | API test for invoice list ordering and status fields. |
| Replay endpoint still depends on provider context quality in metadata | `POST /api/admin/payments/replay` requires enough stored provider context (order/status/hash/total/transaction) or returns `MISSING_PROVIDER_CONTEXT` (`src/app/api/admin/payments/replay/route.ts`). | Some failed legacy rows still require manual SQL/provider lookup to replay. | Add operator-assisted replay form fields and context repair endpoint for known rows. | API tests for manual context override success/failure paths. |
| Calendar/reporting semantics still partially duplicated | Blocking logic is centralized for blockouts (`src/lib/bookings/bookingBlocking.ts`), but reporting/list modules still apply local overridden filters (`src/lib/reports/adminReports.ts`, `src/lib/bookings/adminBookingsList.ts`). | Count mismatches across calendar/list/reports for overridden/lost bookings. | Reuse one shared operational-state helper across report/list/calendar queries. | Cross-surface parity tests for identical date/status windows. |

## Low Priority

| Gap | Observed behavior (code paths) | Risk | Minimal fix | Test needed |
|---|---|---|---|---|
| Quote acceptance remains admin/operator-driven | No dedicated public acceptance endpoint despite `ACCEPTED` status support (`src/lib/quotes/lifecycle.ts`, `src/app/api/admin/quotes/[id]/route.ts`). | Manual acceptance can reduce auditability for customer-driven quote approvals. | Add tokenized quote-accept endpoint writing `quote_events(STATUS_CHANGED)` with actor context. | API test for accept endpoint + event write. |
| Audit data is rich but fragmented by store | Evidence spans `audit_logs`, `quote_events`, `quote_emails`, `payments.metadata_json`, `notification_dispatch_log`, `booking_invoice_documents`. | Longer incident triage and manual stitching for support/legal disputes. | Add unified “entity timeline” read model endpoint. | API test for merged chronological timeline and source labeling. |

## Cross-Cut Mapping (Requested Areas)

### Availability correctness
- High: booking create race and missing idempotency at public create.

### Pricing correctness
- Medium: JSON snapshot contract drift risk.

### Payment reconciliation
- Medium: replay works but context completeness can still block automated recovery.

### Invoice/receipt triggers
- Medium: invoice ledger exists; read/query surfaces are still thin.

### Email triggers
- Medium: dedupe is not yet universal across all trigger families.

### Calendar consistency
- Medium: semantics partially centralized, partially duplicated.

### Idempotency
- High: public booking create retries are not fully idempotent.

### Auditability
- Low/Medium: logs are available but not unified into one operational timeline.

## What Is Already Improved (for context)
- Quote status transition guard map + deterministic expiry checks are implemented.
- Blockout overlap uses timestamp-normalized windows and shared blocking semantics.
- Admin WiPay replay endpoint exists and reuses canonical reconciler.
- Notification dedupe log + booking invoice ledger tables are live and wired in key runtime paths.
