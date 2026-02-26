# Vehicle Finance Retirement Runbook

## Purpose
- `vehicle_depreciation_profiles` is the active source of truth for depreciation inputs.
- `vehicle_finance` is retired in place by archiving it to `vehicle_finance_legacy`.
- Runtime code must not depend on legacy table reads/writes.

## Prerequisites
1. Full app tour E2E passes (`npm run e2e:tour`).
2. Runtime scan is clean:
   - `rg "vehicle_finance" -n`
   - Only `migrations/` and `docs/` matches are allowed.
3. Standard validation passes:
   - `npm run lint -- --quiet`
   - `npx tsc --noEmit`
   - `npm run test`
   - `npm run build`

## Apply archive migration
1. Run migrations:
   - `npm run migrate`
2. Migration `023_archive_vehicle_finance.sql` renames:
   - `public.vehicle_finance` -> `public.vehicle_finance_legacy`
3. Re-run tour:
   - `npm run e2e:tour`

## What “green” looks like
- Migration applies cleanly and is re-runnable (no-op after first run).
- Full tour still passes after rename.
- No runtime references to `vehicle_finance` remain in source code.

## Rollback
If rollback is required before full cutover:

```sql
do $$
begin
  if to_regclass('public.vehicle_finance_legacy') is not null
     and to_regclass('public.vehicle_finance') is null then
    execute 'alter table public.vehicle_finance_legacy rename to vehicle_finance';
  end if;
end $$;
```

Then redeploy and rerun regression checks.

