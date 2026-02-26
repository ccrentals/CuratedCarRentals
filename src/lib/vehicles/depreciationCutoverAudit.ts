import { dbQuery } from "@/lib/db";

export type DepreciationCutoverMismatch = {
  vehicleId: string;
  profilePurchasePriceCents: number | null;
  legacyPurchasePriceCents: number | null;
  profileResidualValueCents: number | null;
  legacyResidualValueCents: number | null;
  profileUsefulLifeMonths: number | null;
  legacyUsefulLifeMonths: number | null;
};

export type DepreciationCutoverAudit = {
  vehiclesTotal: number;
  profilesPresent: number;
  profilesMissing: number;
  profilesInactive: number;
  legacyFinanceRowsPresent: number;
  mismatchesFound: number;
  legacyFinanceTablePresent: boolean;
  mismatches: DepreciationCutoverMismatch[];
};

type CountRow = { count: number | string };

function asCount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

export async function runDepreciationCutoverAudit(): Promise<DepreciationCutoverAudit> {
  const [vehiclesTotalResult, profilesPresentResult, profilesInactiveResult, profilesMissingResult] =
    await Promise.all([
      dbQuery<CountRow>("select count(*)::int as count from vehicles"),
      dbQuery<CountRow>("select count(*)::int as count from vehicle_depreciation_profiles"),
      dbQuery<CountRow>(
        "select count(*)::int as count from vehicle_depreciation_profiles where is_active = false",
      ),
      dbQuery<CountRow>(
        `select count(*)::int as count
         from vehicles v
         left join vehicle_depreciation_profiles dp on dp.vehicle_id = v.id
         where dp.vehicle_id is null`,
      ),
    ]);

  return {
    vehiclesTotal: asCount(vehiclesTotalResult.rows[0]?.count),
    profilesPresent: asCount(profilesPresentResult.rows[0]?.count),
    profilesMissing: asCount(profilesMissingResult.rows[0]?.count),
    profilesInactive: asCount(profilesInactiveResult.rows[0]?.count),
    legacyFinanceRowsPresent: 0,
    mismatchesFound: 0,
    legacyFinanceTablePresent: false,
    mismatches: [],
  };
}

