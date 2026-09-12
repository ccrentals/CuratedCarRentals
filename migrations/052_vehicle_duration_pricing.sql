-- Disabled by default: existing vehicles and saved booking prices are unchanged.
alter table vehicle_pricing_rules
  add column if not exists duration_pricing_enabled boolean not null default false,
  add column if not exists duration_tiers_json jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_duration_tiers_array') then
    alter table vehicle_pricing_rules add constraint vehicle_duration_tiers_array
      check (jsonb_typeof(duration_tiers_json) = 'array');
  end if;
end $$;
