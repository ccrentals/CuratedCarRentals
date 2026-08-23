# Booking Revamp Overlap Audit (Historical)

Original audit: 2026-02-19

Retirement addendum: 2026-08-23

> **Historical planning snapshot:** The requirement gaps below describe the repository before the booking revamp and are not a current implementation checklist. For current payment architecture, use `docs/discovery/01_SYSTEM_MAP.md` and `docs/discovery/04_STATE_MACHINES.md`. Public online payments are now Stripe-only; legacy provider rows remain unchanged solely for ledger and audit accuracy.

## Scope
Audit of existing public booking + admin booking/payment systems before implementing the booking revamp requirements.

## Current implementation (what exists)

### Public booking flow
- Entry route: `src/app/(site)/book/page.tsx`
- Current UX is a single-page form, not a 6-step wizard.
- Creates booking via `POST /api/public/bookings` (`src/app/api/public/bookings/route.ts`).
- After create, user is redirected to `/bookings/[id]` summary page.
- Payment options are handled later on `/bookings/[id]/pay` using:
  - deposit/full/custom (`POST /api/payments/start` with the corresponding mode)
  - pay on pickup (`/api/public/bookings/[id]/pay-on-pickup`)
- Balance payments use `/bookings/[id]/balance` + `POST /api/payments/start` with `mode='balance'`.

### Pricing + payment
- Central pricing helper exists: `src/lib/payments/pricing.ts`.
- Recalculation helper exists and is reused broadly: `src/lib/payments/recalculateBooking.ts`.
- Promo/coupon system exists:
  - admin CRUD in `/admin/promo-codes`
  - runtime validation/redemption in `src/lib/promos.ts`
  - public apply/remove endpoints in `src/app/api/public/bookings/[id]/promo/route.ts`
- Stripe Checkout converts whole-JMD booking amounts to provider minor units through `src/lib/payments/stripe.ts`.

### Availability/hold behavior
- Overlap hold logic exists in `src/lib/bookings/holds.ts`.
- Booking overlap checks are used when creating/updating bookings.
- Current overlap blocking is payment-aware (paid/hold-minimum logic) and supports override of unpaid overlaps.
- Current public vehicle list endpoint does not filter by selected date/time (`/api/public/vehicles` returns all visible active vehicles).

### Admin
- Vehicles have admin create/list/edit flows.
- Blockouts exist (`blockouts` table + admin UI).
- Settings are persisted via `admin_documents` and editable in admin.
- Customers and bookings are editable in admin, but customer profile fields are currently limited.

### Data/storage baseline
- Runtime data model is SQL-first (`db/schema.sql` + `migrations/*.sql`), not Prisma-client driven.
- Existing customer legal ID fields are single-value (`legal_id_type`, `legal_id_number`, `legal_id_image_url`).
- Upload flow currently uses Uploadcare public URLs for ID image.

## Requirement-by-requirement gap analysis

### A) 6-step booking wizard with same flow/options
- **Exists:** booking + payment capabilities exist.
- **Missing:** 6-step public wizard UI (`Dates → Vehicles → Features → Customer → Confirm → Payments`).

### B) Pickup/return options + admin-managed pickup locations
- **Exists:** single free-text `pickup_location` on booking.
- **Missing:** normalized pickup location management (add/delete in admin), return location capture, custom address branch handling, and booking snapshot strings for deleted locations.

### C) Strict “Available Vehicle Classes” rule
- **Exists:** overlap checks at booking create/update; booking-hold classification exists.
- **Missing:** date/time aware vehicle list filtering on Vehicles step, plus authoritative re-check at (1) step load, (2) select, (3) final confirm, and explicit blockout integration in the availability query.

### D) Coupons in public booking flow
- **Exists:** coupons can be applied on post-booking payment page.
- **Missing:** coupon input/validation during booking wizard with summary breakdown at confirm and persistence at booking creation path.

### E) ID capture + backend secure storage
- **Exists:** camera/file trigger support via file input and Uploadcare upload.
- **Missing:** private backend storage for sensitive docs, access control for booking owner/admin, and multi-document attachment support.

### F) Full Coverage Insurance Plan (admin + booking)
- **Exists:** no insurance plan model/config.
- **Missing:** admin config (enable/disable + price/day), booking selection, pricing integration, and persistence.

### G) Customer info rules + backend fields
- **Exists:** customer has `full_name`, `email`, `phone`, plus `address/notes`.
- **Missing:** required split first/last names for booking flow and optional full address/profile field set (`street`, `street2`, `city`, `state`, `zip`, `country`, `birthday`) wired through booking/admin updates.

### H) Driver’s License section + multiple IDs
- **Exists:** single legal ID fields on customer.
- **Missing:** dedicated DL number/expiry + DL images (or typed docs), optional section persistence, admin visibility.

### I) Signature capture + storage
- **Exists:** none.
- **Missing:** signature pad UI, backend persistence, admin visibility.

### J) Payment options + messaging updates
- **Exists:** FULL, DEPOSIT, PAY_ON_PICKUP behavior already present (booking can exist unpaid).
- **Missing:** `CUSTOM` amount option, validation/warnings for custom amount vs deposit, explicit entitlement messaging at booking finalization, and persisted structured payment intent fields.

### K) Hosted checkout + JMD end-to-end consistency
- **Current addendum:** Stripe is the only public payment provider. Checkout uses JMD and the shared pricing/payment-start helpers enforce amount conversion and option handling.
- **Original gap:** enforce one central pricing source for wizard summary + provider amount parity for all payment options, and audit remaining display labels in new booking flow pages.

## High-impact implementation notes
- Main booking/payout state lives in `bookings.pricing_json` today; this will be kept for backward compatibility, with additive columns/tables for new normalized data.
- Current `*_cents` columns are legacy-named but treated as whole JMD dollars. New logic should preserve this to avoid accidental scaling bugs.
- Availability currently ignores time granularity (date-only booking columns). New pickup/return time support should be modeled safely without breaking existing date-based records.
- Sensitive docs/signatures should avoid direct public URLs; backend-controlled retrieval endpoints are required.

## Initial safe rollout order
1. Add schema/migration foundations (new columns/tables only, backward compatible defaults).
2. Add centralized availability/pricing helpers and use them in APIs before UI revamp.
3. Extend admin management (pickup locations + insurance config).
4. Build new 6-step UI and wire to new/updated APIs.
5. Add tests around availability, pricing, validation, and payment payload correctness.
