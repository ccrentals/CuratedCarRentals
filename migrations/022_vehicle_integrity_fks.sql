-- Depreciation/maintenance integrity hardening (additive, idempotent, safe)
-- Retirement of legacy vehicle_finance is deferred to a future migration.

do $$
begin
  if to_regclass('public.vehicle_depreciation_profiles') is not null then
    -- Pre-clean values so constraints can be applied safely on existing datasets.
    update public.vehicle_depreciation_profiles
    set purchase_price_cents = null
    where purchase_price_cents < 0;

    update public.vehicle_depreciation_profiles
    set expected_rest_value_cents = null
    where expected_rest_value_cents < 0;

    update public.vehicle_depreciation_profiles
    set depreciation_months = null
    where depreciation_months <= 0;

    update public.vehicle_depreciation_profiles
    set expected_rest_value_cents = purchase_price_cents
    where purchase_price_cents is not null
      and expected_rest_value_cents is not null
      and expected_rest_value_cents > purchase_price_cents;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'vehicle_depreciation_profiles_purchase_price_non_negative'
    ) then
      alter table public.vehicle_depreciation_profiles
        add constraint vehicle_depreciation_profiles_purchase_price_non_negative
          check (purchase_price_cents >= 0);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'vehicle_depreciation_profiles_rest_value_non_negative'
    ) then
      alter table public.vehicle_depreciation_profiles
        add constraint vehicle_depreciation_profiles_rest_value_non_negative
          check (expected_rest_value_cents >= 0);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'vehicle_depreciation_profiles_months_positive'
    ) then
      alter table public.vehicle_depreciation_profiles
        add constraint vehicle_depreciation_profiles_months_positive
          check (depreciation_months > 0);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'vehicle_depreciation_profiles_residual_lte_purchase_price'
    ) then
      alter table public.vehicle_depreciation_profiles
        add constraint vehicle_depreciation_profiles_residual_lte_purchase_price
          check (expected_rest_value_cents <= purchase_price_cents);
    end if;

    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_class ft on ft.oid = c.confrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
      where c.contype = 'f'
        and n.nspname = 'public'
        and t.relname = 'vehicle_depreciation_profiles'
        and ft.relname = 'vehicles'
        and a.attname = 'vehicle_id'
    ) then
      alter table public.vehicle_depreciation_profiles
        add constraint vehicle_depreciation_profiles_vehicle_id_fk
          foreign key (vehicle_id) references public.vehicles(id) on delete cascade;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.vehicle_maintenance_status_history') is not null then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_class ft on ft.oid = c.confrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
      where c.contype = 'f'
        and n.nspname = 'public'
        and t.relname = 'vehicle_maintenance_status_history'
        and ft.relname = 'vehicle_maintenance_records'
        and a.attname = 'maintenance_record_id'
    ) then
      alter table public.vehicle_maintenance_status_history
        add constraint vehicle_maintenance_status_history_record_fk
          foreign key (maintenance_record_id)
          references public.vehicle_maintenance_records(id)
          on delete cascade;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.vehicle_documents') is not null then
    alter table public.vehicle_documents
      add column if not exists maintenance_record_id uuid;

    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_class ft on ft.oid = c.confrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
      where c.contype = 'f'
        and n.nspname = 'public'
        and t.relname = 'vehicle_documents'
        and ft.relname = 'vehicle_maintenance_records'
        and a.attname = 'maintenance_record_id'
    ) then
      alter table public.vehicle_documents
        add constraint vehicle_documents_maintenance_record_fk
          foreign key (maintenance_record_id)
          references public.vehicle_maintenance_records(id)
          on delete set null;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.blockouts') is not null then
    alter table public.blockouts
      add column if not exists linked_maintenance_id uuid;

    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_class ft on ft.oid = c.confrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
      where c.contype = 'f'
        and n.nspname = 'public'
        and t.relname = 'blockouts'
        and ft.relname = 'vehicle_maintenance_records'
        and a.attname = 'linked_maintenance_id'
    ) then
      alter table public.blockouts
        add constraint blockouts_linked_maintenance_fk
          foreign key (linked_maintenance_id)
          references public.vehicle_maintenance_records(id)
          on delete set null;
    end if;
  end if;
end $$;
