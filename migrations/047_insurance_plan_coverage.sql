alter table insurance_plans
  add column if not exists coverage_cents int not null default 155000;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'insurance_plans_coverage_check'
  ) then
    alter table insurance_plans
      add constraint insurance_plans_coverage_check check (coverage_cents >= 0);
  end if;
end $$;
