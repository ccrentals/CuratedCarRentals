alter table promo_codes
  add column if not exists apply_scope text default 'OVERALL_TOTAL';

update promo_codes
set apply_scope = 'OVERALL_TOTAL'
where apply_scope is null;

alter table promo_codes
  alter column apply_scope set default 'OVERALL_TOTAL';

alter table promo_codes
  alter column apply_scope set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'promo_codes_apply_scope_check'
      and conrelid = 'promo_codes'::regclass
  ) then
    alter table promo_codes
      add constraint promo_codes_apply_scope_check
      check (apply_scope in ('OVERALL_TOTAL', 'DAYS_TOTAL'));
  end if;
end $$;
