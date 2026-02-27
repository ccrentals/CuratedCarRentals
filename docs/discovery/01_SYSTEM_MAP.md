# 01 System Map

## Scope
Runtime map for the Quote -> Booking -> Payment -> Invoice/Email -> Calendar lifecycle.

## Overlap Audit (Existing Docs Reused)
Referenced instead of duplicated:
- `docs/booking-revamp-overlap-audit.md`
- `docs/implementation-tracker.md`
- `docs/security/SECURITY_STACK.md`
- `docs/security/CLERK_ADMIN_CUTOVER_RUNBOOK.md`
- `docs/security/CLOUDFLARE_WAF_SETUP.md`

This discovery pack consolidates lifecycle behavior across those docs and current code.

## Canonical Entry Points
- Admin quote UI:
  - `src/app/admin/(protected)/bookings/quotes/page.tsx`
  - `src/app/admin/(protected)/bookings/quotes/[id]/page.tsx`
- Admin booking UI:
  - `src/app/admin/(protected)/bookings/page.tsx`
  - `src/app/admin/(protected)/bookings/[id]/page.tsx`
- Admin calendar UI:
  - `src/app/admin/(protected)/calendar/page.tsx`
- Public booking/payment UI:
  - `src/app/(site)/book/page.tsx`
  - `src/app/(site)/payment/success/page.tsx`
  - `src/app/(site)/bookings/[id]/invoice/page.tsx`

## Lifecycle Flow (Text Diagram)

### A) Public booking-first flow
1. Public form prices rental via `POST /api/public/pricing/quote`.
2. Public booking create calls `POST /api/public/bookings`.
3. API writes booking (`status='PENDING_PAYMENT'`), customer upsert, pricing snapshot, promo redemption, private files.
4. Customer starts checkout via WiPay start endpoints:
   - `POST /api/payments/wipay/start`
   - `POST /api/payments/wipay/full/start`
   - `POST /api/payments/wipay/custom/start`
   - `POST /api/payments/wipay/balance/start`
5. Provider callbacks:
   - Browser return `GET /api/payments/wipay/return`
   - Provider webhook `POST /api/payments/wipay/webhook`
6. Both callback paths call canonical reconciler `reconcileWiPayPayment(...)` in `src/lib/payments/wipayReconcile.ts`.
7. Reconciler updates payment row + booking pricing summary + entitlement/overlap outcomes.
8. Payment success page/invoice page build invoice payload and may create PDF via PDFMonkey.

### B) Admin quote-first flow
1. Admin creates quote via `POST /api/admin/quotes` (default `DRAFT`).
2. Admin updates quote via `PATCH /api/admin/quotes/:id`.
3. Admin quote actions:
   - email quote: `POST /api/admin/quotes/:id/email`
   - render quote PDF: `GET /api/admin/quotes/:id/pdf`
4. Admin converts quote to booking via `POST /api/admin/quotes/:id/convert-to-booking`.
5. Converted booking joins the same payment + entitlement lifecycle above.

### C) Payment operations and replay
1. Diagnostics endpoint: `GET /api/admin/payments/diagnostics`.
2. Replay endpoint: `POST /api/admin/payments/replay`.
3. Replay resolves latest WiPay payment by booking/order/transaction and reuses `reconcileWiPayPayment(...)` (no duplicate reconciliation logic).

### D) Invoice + email traceability
1. Invoice payload endpoint `GET /api/admin/bookings/:id/invoice-payload` computes payload and records ledger row (`booking_invoice_documents`).
2. PDF generation (`src/lib/pdfmonkey.ts`) upserts ledger by `(booking_id, payload_hash)` and stores provider status/doc URL/error.
3. Notification sends are logged through `notification_dispatch_log` using dedupe helper (`src/lib/notifications/dedupe.ts`) in high-risk paths.

### E) Calendar/availability impact
1. Calendar reads bookings + blockouts and renders merged occupancy.
2. Blockout create checks overlapping bookings with normalized timestamp windows and blocking semantics.
3. Maintenance creates linked blockouts (`source='MAINTENANCE'`, `linked_maintenance_id`) that also affect availability.

## Source of Truth Statements

### Availability
Primary runtime source:
- `src/lib/availability/entitlement.ts`
- `src/lib/bookings/availabilityRules.ts`
- `src/lib/bookings/bookingBlocking.ts` (blocking predicate for blockout overlap logic)

Applied in:
- `src/app/api/public/bookings/route.ts`
- `src/lib/publicVehicles.ts`
- `src/lib/quotes/quoteOps.ts`
- `src/app/api/admin/blockouts/route.ts`

### Pricing
Primary runtime source:
- Quote/public pricing composition: `src/lib/quotes/quotePricing.ts` + `src/lib/bookings/pricingRules.ts`
- Booking/payment summary/status math: `src/lib/payments/pricing.ts` + `src/lib/payments/recalculateBooking.ts`

### Calendar occupancy
Primary runtime source:
- Booking range filtering and load: `src/app/admin/(protected)/calendar/page.tsx` + `src/lib/bookings/dateRangeFilter.ts`
- Blockout retrieval: `src/lib/blockouts/shared.ts`
- Blocking booking semantics used in conflict checks: `src/lib/bookings/bookingBlocking.ts`

## Time Window Normalization
Booking windows normalize to timestamps with fallback:
- Start: `coalesce(start_at, start_date::timestamptz)`
- End: `coalesce(end_at, end_date::timestamptz + interval '1 day')`

Normalization appears in:
- `src/lib/availability/entitlement.ts`
- `src/lib/bookings/bookingBlocking.ts`
- `src/app/api/admin/blockouts/route.ts`
- `src/app/admin/(protected)/calendar/page.tsx`

## External Integrations
- WiPay: checkout initiation + return/webhook reconciliation (`src/lib/wipay.ts`, `src/app/api/payments/wipay/*`)
- Resend: transactional email (`src/lib/notifications/email.ts`)
- PDFMonkey: invoice PDF generation (`src/lib/pdfmonkey.ts`)
