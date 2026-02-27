# 06 Tighten-Up Plan

## Scope
Small-batch roadmap to close remaining lifecycle risks without overhauling architecture.

Based on:
- `docs/discovery/01_SYSTEM_MAP.md`
- `docs/discovery/02_DATA_MODEL.md`
- `docs/discovery/03_API_SURFACES.md`
- `docs/discovery/04_STATE_MACHINES.md`
- `docs/discovery/05_GAPS_AND_RISKS.md`

## Planning Principles
- Additive and reversible changes.
- Server-side correctness before UI enhancements.
- Idempotency and deterministic conflict handling first.
- Keep current route contracts stable unless explicitly versioned.
- Every batch must include lint/ts/test/build + headless tour gate (`npm run e2e:watch`).

## Batch F: Public Booking Idempotency + Transaction Locking

### Scope
- Add idempotency key handling to `POST /api/public/bookings`.
- Add per-vehicle advisory lock in booking create transaction.
- Re-check overlap inside transaction right before insert.

### Likely files
- `src/app/api/public/bookings/route.ts`
- `src/lib/publicVehicles.ts` (if shared overlap helper is extracted)
- new migration/table for idempotency keys

### Acceptance checklist
- Same request + same idempotency key returns same booking.
- Parallel create attempts for same vehicle/window produce one winning booking.
- Existing Turnstile and validation behavior unchanged.

### Tests
- API idempotency replay tests.
- Concurrency integration test (parallel submissions).
- Regression tests for existing booking validations.

### E2E gate
- `npm run e2e:watch` booking flow still passes.

## Batch G: Pricing Snapshot Contract Normalization

### Scope
- Introduce runtime `pricing_json` normalizer/validator.
- Apply at quote write, booking write, payment recalculation read paths.
- Avoid changing pricing formulas.

### Likely files
- `src/lib/payments/pricing.ts`
- `src/lib/payments/recalculateBooking.ts`
- `src/lib/quotes/quotePricing.ts`
- `src/lib/quotes/quoteOps.ts`
- optional `src/lib/pricing/snapshotSchema.ts`

### Acceptance checklist
- Missing/legacy keys are normalized to a stable shape.
- No change to displayed totals in existing golden scenarios.
- Reports and API responses stay backward-compatible.

### Tests
- Unit tests for malformed/partial snapshots.
- Integration tests for quote -> booking -> payment recompute.

### E2E gate
- `npm run e2e:watch` quote and booking totals remain stable.

## Batch H: Notification Dedupe Unification

### Scope
- Route all major automated sends through `notification_dispatch_log` helper.
- Standardize dedupe event naming across quote/payments/cron.
- Keep manual resend policy explicit (always-send but logged).

### Likely files
- `src/lib/notifications/email.ts`
- `src/lib/notifications/dedupe.ts`
- `src/app/api/admin/quotes/[id]/email/route.ts`
- `src/app/api/cron/*`
- `src/lib/payments/wipayReconcile.ts` (verify parity)

### Acceptance checklist
- Duplicate trigger paths do not send duplicate automated emails.
- Manual resend remains operator-controlled and traceable.
- Notification log has consistent event taxonomy.

### Tests
- Unit tests for dedupe key strategy.
- Integration tests for return+webhook+cron rerun duplicate scenarios.

### E2E gate
- `npm run e2e:watch` unaffected.

## Batch I: Invoice Ledger Read Surface + Ops Visibility

### Scope
- Add admin invoice ledger read endpoint per booking.
- Include latest ledger status in booking detail payload (lightweight).
- Keep existing invoice UI behavior unchanged unless minimal panel is added.

### Likely files
- new `src/app/api/admin/bookings/[id]/invoices/route.ts`
- `src/app/api/admin/bookings/[id]/route.ts`
- optional admin booking detail component

### Acceptance checklist
- Ops can view invoice history/status without DB access.
- Ledger rows show provider doc id/status/url/error/timestamps.
- No change to invoice generation behavior.

### Tests
- API tests for ordering and filtering by booking id.
- Integration test for payload-hash dedupe visibility.

### E2E gate
- `npm run e2e:watch` and optional booking detail smoke.

## Batch J: Calendar/List/Report Operational-State Parity

### Scope
- Centralize overridden/lost/non-blocking semantics into shared helper.
- Reuse helper in calendar/blockout/list/report queries.
- Preserve existing filtering UI.

### Likely files
- `src/lib/bookings/bookingBlocking.ts`
- `src/lib/bookings/adminBookingsList.ts`
- `src/lib/reports/adminReports.ts`
- `src/app/admin/(protected)/calendar/page.tsx`
- `src/app/api/admin/blockouts/route.ts`

### Acceptance checklist
- Same date/status filter yields consistent counts across calendar/list/reports.
- Overridden/lost bookings are consistently treated as non-blocking.
- No regression in maintenance blockout behavior.

### Tests
- Unit tests for operational-state matrix.
- API/report parity tests against shared fixtures.

### E2E gate
- `npm run e2e:watch` with calendar + bookings smoke.

## Recommended Execution Order
1. Batch F (highest customer-impact correctness risk).
2. Batch G (pricing consistency baseline).
3. Batch H (cross-surface delivery idempotency).
4. Batch I (ops traceability UX for invoice ledger).
5. Batch J (cross-surface occupancy parity).

## Global Acceptance Gates (per batch)
- `npm run lint -- --quiet`
- `npx tsc --noEmit`
- `npm run test`
- `npm run build`
- `npm run e2e:watch`
- `npm run e2e:clean`

## Rollback Strategy
- Keep schema changes additive and idempotent.
- Hide behavior changes behind strict defaults where practical.
- Do not remove existing endpoints in the same batch as logic hardening.
- Include explicit rollback notes in each batch PR.
