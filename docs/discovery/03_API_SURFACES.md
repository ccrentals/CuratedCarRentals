# 03 API Surfaces

## Scope
Endpoint inventory for Quote / Booking / Payments / Calendar lifecycle, including side effects.

## Auth Legend
- `Public`
- `Public+CSRF`
- `Public+Turnstile`
- `Staff/Admin`
- `Admin`
- `CronSecret` (`x-cron-secret`)

## Admin APIs

| Method + Path | Request shape (key fields) | Response shape | Auth | Side effects | File |
|---|---|---|---|---|---|
| `GET /api/admin/quotes` | query: `q,status,createdFrom,createdTo,rentalFrom,rentalTo,sortBy,sortDir,limit,cursor` | `{ ok, items, nextCursor, hasMore, totalCount }` | Staff/Admin | read only | `src/app/api/admin/quotes/route.ts` |
| `POST /api/admin/quotes` | quote payload (customer/window/vehicle/pricing flags), CSRF | `{ ok, item }` | Staff/Admin + CSRF | writes `quotes`, writes `quote_events(CREATED)` | `src/app/api/admin/quotes/route.ts` |
| `GET /api/admin/quotes/:id` | path `id` | `{ ok, item }` | Staff/Admin | read only (effective status derived) | `src/app/api/admin/quotes/[id]/route.ts` |
| `PATCH /api/admin/quotes/:id` | mutable quote fields + optional `status`, CSRF | `{ ok, item }` or typed error | Staff/Admin + CSRF | updates quote; logs `quote_events(UPDATED/STATUS_CHANGED)` | `src/app/api/admin/quotes/[id]/route.ts` |
| `POST /api/admin/quotes/:id/email` | `toEmail,message,csrfToken` | `{ ok,toEmail,subject,providerMessageId }` | Staff/Admin + CSRF | rate limits + Resend send + `quote_emails` + `quote_events(EMAILED)`; blocks expired quotes | `src/app/api/admin/quotes/[id]/email/route.ts` |
| `GET /api/admin/quotes/:id/pdf` | path `id` | PDF stream | Staff/Admin | logs quote PDF event | `src/app/api/admin/quotes/[id]/pdf/route.ts` |
| `POST /api/admin/quotes/:id/convert-to-booking` | `csrfToken` | `{ ok, bookingId, alreadyConverted, bookingUrl }` | Staff/Admin + CSRF | creates booking + quote conversion event; blocks expired quotes | `src/app/api/admin/quotes/[id]/convert-to-booking/route.ts` |
| `GET /api/admin/bookings` | query: status/scope/date/search/sort/cursor | booking page payload | Staff/Admin | read only | `src/app/api/admin/bookings/route.ts` |
| `POST /api/admin/bookings` | manual booking payload + CSRF | `{ bookingId,status,promoApplied }` | Admin + CSRF | writes booking/customer/promo, sends booking-created email, audit log | `src/app/api/admin/bookings/route.ts` |
| `GET /api/admin/bookings/:id` | path `id` | `{ booking, customer, vehicle, payments }` | Staff/Admin | read + computed payment summary | `src/app/api/admin/bookings/[id]/route.ts` |
| `PATCH /api/admin/bookings/:id` | action-based body (`confirm`,`pickup`,`complete`,`archive`,`update_details`, etc.) + CSRF | `{ ok, ... }` | Staff/Admin + CSRF | status updates, pricing JSON updates, audit writes, optional note send/cancel | `src/app/api/admin/bookings/[id]/route.ts` |
| `POST /api/admin/bookings/:id/cancel` | `csrfToken` | `{ ok }` | Staff/Admin + CSRF | sets status `CANCELLED`, audit log | `src/app/api/admin/bookings/[id]/cancel/route.ts` |
| `POST /api/admin/bookings/:id/add-payment` | manual payment fields + CSRF | `{ ok, summary }` | Staff/Admin + CSRF | inserts `payments`, recalculates booking, entitlement checks, audit/email side effects | `src/app/api/admin/bookings/[id]/add-payment/route.ts` |
| `POST /api/admin/bookings/:id/mark-deposit-paid` | `csrfToken` | `{ ok, summary }` | Staff/Admin + CSRF | manual `DEPOSIT_PAID` row + recalculation + entitlement + audit/email | `src/app/api/admin/bookings/[id]/mark-deposit-paid/route.ts` |
| `POST /api/admin/bookings/:id/mark-fully-paid` | `csrfToken` | `{ ok, summary }` | Staff/Admin + CSRF | manual balance row + recalculation + entitlement + audit/email | `src/app/api/admin/bookings/[id]/mark-fully-paid/route.ts` |
| `GET /api/admin/bookings/:id/invoice-payload` | path `id` | `{ payload }` | Staff/Admin | builds invoice payload and upserts `booking_invoice_documents` by payload hash | `src/app/api/admin/bookings/[id]/invoice-payload/route.ts` |
| `POST /api/admin/bookings/:id/resend-email` | `type,csrfToken` | `{ ok }` | Staff/Admin + CSRF | sends booking emails (intentional resend), logs in `notification_dispatch_log` | `src/app/api/admin/bookings/[id]/resend-email/route.ts` |
| `PATCH /api/admin/payments/:paymentId` | action `delete|restore` + metadata + CSRF | `{ ok, summary }` | Admin + CSRF | soft-delete/restore payment rows, recalc booking, audit | `src/app/api/admin/payments/[paymentId]/route.ts` |
| `POST /api/admin/payments/:paymentId/refund` | reason + CSRF | `{ ok, summary }` | Admin + CSRF | inserts negative `REFUNDED` row, recalc booking, audit | `src/app/api/admin/payments/[paymentId]/refund/route.ts` |
| `GET /api/admin/payments/export` | query filters | CSV | Admin | export only | `src/app/api/admin/payments/export/route.ts` |
| `GET /api/admin/blockouts` | query `start,end,vehicleId` | `{ blockouts }` | Staff/Admin | read only | `src/app/api/admin/blockouts/route.ts` |
| `POST /api/admin/blockouts` | `vehicleId,startAt,endAt,reason,notes,csrfToken` | `{ blockout }` or `{ blockout, autoCancelledBookings }` | Staff/Admin + CSRF | writes blockout; optional supersede cancels blocking bookings + recalc + email + audit | `src/app/api/admin/blockouts/route.ts` |
| `PATCH /api/admin/blockouts/:id` | blockout fields + CSRF | `{ blockout }` | Staff/Admin + CSRF | updates blockout row | `src/app/api/admin/blockouts/[id]/route.ts` |
| `DELETE /api/admin/blockouts/:id` | path + CSRF | `{ ok }` | Staff/Admin + CSRF | deletes blockout | `src/app/api/admin/blockouts/[id]/route.ts` |

## Public APIs

| Method + Path | Request shape | Response shape | Auth | Side effects | File |
|---|---|---|---|---|---|
| `GET /api/public/vehicles` | optional date/time window query | `{ vehicles }` | Public | availability-filtered read | `src/app/api/public/vehicles/route.ts` |
| `POST /api/public/pricing/quote` | `vehicleId,startAt,endAt,...` | `{ ok, summary, currency, ... }` | Public | pricing preview only | `src/app/api/public/pricing/quote/route.ts` |
| `POST /api/public/bookings` | booking payload + turnstile token | `{ bookingId, bookingAccessToken, status, promoApplied }` | Public+Turnstile | writes customer/booking/promo/private files, sends booking-created email | `src/app/api/public/bookings/route.ts` |
| `POST /api/public/bookings/:id/promo` | promo code + CSRF | `{ ok, summary, promo }` | Public+CSRF | updates pricing snapshot and promo redemption | `src/app/api/public/bookings/[id]/promo/route.ts` |
| `DELETE /api/public/bookings/:id/promo` | path + CSRF | `{ ok, summary }` | Public+CSRF | removes promo effects | `src/app/api/public/bookings/[id]/promo/route.ts` |
| `POST /api/public/bookings/:id/pay-on-pickup` | path + CSRF | `{ ok, bookingId, paymentStatus, ... }` | Public+CSRF | updates booking status/payment option snapshot | `src/app/api/public/bookings/[id]/pay-on-pickup/route.ts` |
| `GET /api/public/bookings/:id/private-files/:documentType` | path (`DRIVERS_LICENSE|SIGNATURE`) | file stream | Public token/admin | secure private file retrieval | `src/app/api/public/bookings/[id]/private-files/[documentType]/route.ts` |
| `GET /api/public/locations` | none | `{ locations }` | Public | read only | `src/app/api/public/locations/route.ts` |
| `GET /api/public/insurance` | optional `vehicleId` | `{ insurance }` | Public | read only | `src/app/api/public/insurance/route.ts` |
| `POST /api/public/promos/validate` | promo validation input | validation payload | Public | read only | `src/app/api/public/promos/validate/route.ts` |

## Cron / Scheduled Endpoints

| Method + Path | Auth | Side effects | File |
|---|---|---|---|
| `POST /api/cron/pickup-reminders` | CronSecret | sends pickup reminders, stamps reminder markers, run logs/audit | `src/app/api/cron/pickup-reminders/route.ts` |
| `POST /api/cron/balance-reminders` | CronSecret | sends balance reminders, stamps markers, run logs/audit | `src/app/api/cron/balance-reminders/route.ts` |
| `POST /api/cron/note-emails` | CronSecret | sends scheduled note emails, stamps markers, run logs/audit | `src/app/api/cron/note-emails/route.ts` |
| `POST /api/cron/maintenance-reminders` | CronSecret | sends maintenance reminders and logs run | `src/app/api/cron/maintenance-reminders/route.ts` |
| `POST /api/admin/cron/run-*` / `simulate-reminders` | Admin + CSRF | admin wrappers invoke cron surfaces for manual operations | `src/app/api/admin/cron/*` |
