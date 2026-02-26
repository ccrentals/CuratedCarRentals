# Depreciation Cutover Runbook

## What changed
- `vehicle_depreciation_profiles` is the active source of truth for vehicle depreciation profile inputs.
- Legacy `vehicle_finance` remains in place for cutover validation only in this phase.
- Writes should continue to use profile-backed APIs (`/api/admin/vehicles/:id/finance`) and not legacy finance rows.

## How to run the cutover audit
### API
- Endpoint: `GET /api/admin/depreciation/cutover-audit`
- Auth: staff/admin session required
- Response includes:
  - `counts.vehicles_total`
  - `counts.profiles_present`
  - `counts.profiles_missing`
  - `counts.profiles_inactive`
  - `counts.legacy_finance_rows_present`
  - `counts.mismatches_found`
  - `mismatches` (top 50 profile vs legacy diffs)

## What "green" looks like
- `profiles_missing = 0` for vehicles with legacy finance rows.
- `mismatches_found = 0` (or intentionally accepted, documented diffs).
- `profiles_present` tracks expected active fleet coverage.
- `profiles_inactive` only includes intentionally deactivated depreciation profiles.

## Retirement plan
1. Keep writes on `vehicle_depreciation_profiles` only (already in place).
2. Run cutover audit regularly and confirm green for a stability window (for example 7+ days).
3. Follow `docs/ops/VEHICLE_FINANCE_RETIREMENT.md` for archive migration and rollback steps.

## Rollback / backfill guidance
- If a vehicle profile is missing:
  - Re-save the vehicle finance/depreciation form in admin (`/api/admin/vehicles/:id/finance`), or
  - Backfill from legacy row using a controlled script/migration in a maintenance window.
- Re-run `GET /api/admin/depreciation/cutover-audit` to confirm counts recover.
