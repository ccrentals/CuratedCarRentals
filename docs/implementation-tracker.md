# Curated Car Rentals - Implementation Tracker

Last updated: 2026-02-11

## Status Legend
- `DONE` - implemented and verified
- `IN_PROGRESS` - implemented partially or awaiting full verification
- `TODO` - not started
- `BLOCKED` - waiting on user/external input

## Current Phase Snapshot
- Phase: Admin refinement + workflow completion
- Overall state: `IN_PROGRESS`

## Completed
- `DONE` Admin core pages and shell (`Dashboard`, `Bookings`, `Calendar`, `Vehicles`, `Payments`, `Users`, `Settings`, `Health`, `Reports`, `Cron`).
- `DONE` Booking archive flow foundation:
  - `/admin/bookings/archive`
  - archived bookings hidden by default on main list
  - archived filter/toggle support
- `DONE` Payment management foundation:
  - manual payment form/actions
  - payment row action framework (restore/refund/void hooks)
- `DONE` User management foundation:
  - username + email login
  - username generation format `firstname.lastname`
  - lock/unlock/reset/deactivate/reactivate actions
- `DONE` Settings persistence foundation via `admin_documents` (`settings` key).

## In Progress
- `IN_PROGRESS` None.

## Newly Completed
- `DONE` Calendar settings extension:
  - admin-configurable Day View booking display limit
  - settings persistence wired to Calendar Day View truncation
  - supports numeric limits and `all`
- `DONE` Admin create-booking modal end-to-end flow (create booking + optional immediate manual payment + post-create navigation).
- `DONE` Booking detail header/actions layout consistency pass (inline booking badge/id alignment + action row stability + cancel disabled-state polish).
- `DONE` Calendar UX polish + modal consistency:
  - weekday headers added (Sun-first)
  - day tiles hide zero-count text and show light-gold count badges when totals exist
  - Day View now defaults to first 5 bookings with show more/show less toggle
  - blockout modal supports outside-click close and warning-badge validation feedback
- `DONE` Scheduled note emails (send at specific date/time) with dual-target delivery:
  - new `/api/cron/note-emails` dispatcher
  - Netlify scheduled function (`cron-note-emails`) every 15 minutes
  - note metadata updates (`email_customer_sent_at`, `email_internal_sent_at`, `email_last_error`) persisted on send attempts

## Remaining
- `DONE` Blockout supersede automation controlled by settings:
  - auto-cancel overlapping bookings when enabled
  - block future bookings when enabled
  - cancellation email/log workflow
- `TODO` Dashboard expansion:
  - upcoming pickups today
  - outstanding balances
  - vehicles in maintenance
  - quick create booking
- `TODO` Final theme/hover/color-state consistency sweep across new actions.
- `TODO` Full regression + final acceptance checklist run.

## User Input / External Dependencies (Hold List)
- `BLOCKED` Any Neon schema updates not yet applied in target environment.
- `BLOCKED` Any Netlify env changes required for production-only flows.

## Operating Rule For Next Batches
After each batch:
1. Update this tracker status.
2. List what changed.
3. Provide verification steps.
4. Stop for next instruction (unless explicitly told to continue through remaining tasks).
