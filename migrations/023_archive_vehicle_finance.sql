-- Archive legacy vehicle_finance table after depreciation profile cutover.
-- Safe/idempotent rename: no-op if already archived.

do $$
begin
  if to_regclass('public.vehicle_finance') is not null
     and to_regclass('public.vehicle_finance_legacy') is null then
    execute 'alter table public.vehicle_finance rename to vehicle_finance_legacy';
  end if;
end $$;

