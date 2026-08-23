# 04 State Machines

## Scope
Runtime status definitions and transitions for Quotes, Bookings, Payments, and Calendar occupancy.

## Source References
- Quotes:
  - `src/lib/quotes/lifecycle.ts`
  - `src/lib/quotes/adminQuotes.ts`
  - `src/app/api/admin/quotes/[id]/route.ts`
  - `src/app/api/admin/quotes/[id]/email/route.ts`
  - `src/app/api/admin/quotes/[id]/convert-to-booking/route.ts`
  - `src/lib/quotes/quoteOps.ts`
- Bookings:
  - `src/app/api/public/bookings/route.ts`
  - `src/app/api/public/bookings/[id]/pay-on-pickup/route.ts`
  - `src/app/api/admin/bookings/[id]/route.ts`
  - `src/app/api/admin/bookings/[id]/cancel/route.ts`
  - `src/lib/availability/entitlement.ts`
- Payments:
  - `src/app/api/payments/start/route.ts`
  - `src/app/api/payments/stripe/*`
  - `src/lib/payments/publicPaymentStart.ts`
  - `src/lib/payments/stripeReconcile.ts`
  - `src/app/api/admin/payments/[paymentId]/reconcile/route.ts`
  - `src/app/api/admin/payments/[paymentId]/refund/route.ts`
  - `src/lib/payments/pricing.ts`
  - `src/lib/payments/recalculateBooking.ts`
- Calendar/occupancy:
  - `src/lib/bookings/bookingBlocking.ts`
  - `src/app/api/admin/blockouts/route.ts`
  - `src/app/admin/(protected)/calendar/page.tsx`
  - `src/lib/availability/entitlement.ts`

## A) Quote Status Machine

### Canonical status set
From `QUOTE_STATUSES` (`src/lib/quotes/lifecycle.ts`):
- `DRAFT`
- `SENT`
- `ACCEPTED`
- `EXPIRED`
- `CONVERTED`
- `CANCELLED`

### Transition guard map (enforced)
From `QUOTE_STATUS_TRANSITIONS` + `getQuoteStatusTransitionError(...)`:
- `DRAFT` -> `SENT`,`CANCELLED`
- `SENT` -> `ACCEPTED`,`EXPIRED`,`CANCELLED`
- `ACCEPTED` -> `CONVERTED`,`EXPIRED`,`CANCELLED`
- `EXPIRED` -> none
- `CONVERTED` -> none
- `CANCELLED` -> none

Applied in update flow:
- `src/lib/quotes/adminQuotes.ts` (`updateAdminQuote`)

### Derived expiry behavior
`resolveEffectiveQuoteStatus(...)` marks `DRAFT|SENT|ACCEPTED` as effectively `EXPIRED` when `now > expires_at`.
Used in quote list/detail mappers and ops fetch.

### Operational guards
- Quote email route blocks expired quote sends with `QUOTE_EXPIRED`.
- Quote convert route and quoteOps conversion block expired quote conversion.

## B) Booking Status Machine

### Runtime statuses observed
Primary write-path statuses:
- `PENDING_PAYMENT`
- `CONFIRMED`
- `PICKED_UP`
- `RETURNED`
- `CANCELLED`

Derived/semantic states in reporting and conflict logic:
- `OVERRIDDEN` semantics via pricing markers (`overridden_by_booking_id`, `cancel_reason=LOST_TO_FIRST_DEPOSIT`)

### Transition paths
- Create -> `PENDING_PAYMENT`
  - Public create (`src/app/api/public/bookings/route.ts`)
  - Quote conversion (`src/lib/quotes/quoteOps.ts`)
  - Admin manual create (`src/app/api/admin/bookings/route.ts`)
- `PENDING_PAYMENT|PENDING` -> `CONFIRMED`
  - Admin confirm action
  - Pay-on-pickup route
  - Entitlement after successful payment
- `CONFIRMED` -> `PICKED_UP`
  - Admin pickup action (requires paid-in-full summary)
- `CONFIRMED|PICKED_UP` -> `RETURNED`
  - Admin complete action
- non-returned open states -> `CANCELLED`
  - Admin cancel
  - Blockout supersede path
  - Entitlement loser path (`LOST_TO_FIRST_DEPOSIT`)

### Entitlement winner/loser semantics
In `src/lib/availability/entitlement.ts`:
- Per-vehicle advisory lock (`pg_advisory_xact_lock(hashtext(vehicle_id))`)
- Deterministic winner by entitlement timestamp/payment threshold/created ordering
- Losers cancelled and marked in `pricing_json`

## C) Payment State Machine

### Payment row statuses (`payments.status`)
- `INITIATED`
- `DEPOSIT_PAID`
- `FAILED`
- `REFUNDED` (separate negative ledger row)

### Booking payment summary status (`pricing_json.payment_status`)
Computed in pricing helpers:
- `UNPAID`
- `DUE_ON_PICKUP`
- `DEPOSIT_PAID`
- `PAID_IN_FULL`

### Transition paths
- The unified payment start route inserts Stripe `INITIATED` rows and creates or reuses a Stripe Checkout Session.
- Stripe return, webhook, and per-payment admin reconciliation promote a row to `DEPOSIT_PAID`, leave it pending, or mark it `FAILED` according to the provider session.
- Manual admin payment actions insert `DEPOSIT_PAID` rows (`provider='MANUAL'`).
- Refund endpoint inserts `REFUNDED` row, preserving original paid rows.
- Historical `provider='WIPAY'` rows remain unchanged for ledger accuracy; no new WiPay rows are created.

### Reconciliation outcomes
`reconcileStripeCheckoutSession(...)` returns outcomes:
- `paid`
- `pending`
- `failed`
- `not_found`
- `overlap`

The Stripe return/webhook routes and `POST /api/admin/payments/:paymentId/reconcile` map these outcomes to their respective redirect or API responses.

## D) Calendar / Occupancy State Model

### Occupancy is derived, not persisted
Occupancy comes from overlapping windows of:
- bookings considered blocking
- blockouts (manual + maintenance)

### Blocking booking rules
`isBookingBlockingAvailability(...)` returns non-blocking when:
- status in `CANCELLED`,`RETURNED`,`OVERRIDDEN`
- or pricing indicates lost/overridden (`cancel_reason=LOST_TO_FIRST_DEPOSIT`, `overridden_by_booking_id`, `entitlement_status=LOST`)

### Time window normalization
- Start: `coalesce(start_at, start_date::timestamptz)`
- End: `coalesce(end_at, end_date::timestamptz + interval '1 day')`

Used in blockout overlap checks and calendar booking ordering.

## Practical State Notes
- Quote lifecycle now has explicit transition enforcement and expiry guards.
- Booking and payment DB columns remain free-text; correctness still depends on runtime normalization.
- Calendar consistency improved by shared booking-blocking helper, but reporting modules still apply some local normalization logic.
