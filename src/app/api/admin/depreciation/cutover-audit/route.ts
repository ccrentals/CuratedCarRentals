import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";
import {
  runDepreciationCutoverAudit,
  type DepreciationCutoverAudit,
} from "@/lib/vehicles/depreciationCutoverAudit";

type RouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  runAudit: () => Promise<DepreciationCutoverAudit>;
};

const DEFAULT_DEPS: RouteDeps = {
  getSession: () => getSessionFromRequest(),
  runAudit: () => runDepreciationCutoverAudit(),
};

export async function handleAdminDepreciationCutoverAuditGet(
  _request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  try {
    const audit = await deps.runAudit();

    return NextResponse.json({
      ok: true,
      counts: {
        vehicles_total: audit.vehiclesTotal,
        profiles_present: audit.profilesPresent,
        profiles_missing: audit.profilesMissing,
        profiles_inactive: audit.profilesInactive,
        legacy_finance_rows_present: audit.legacyFinanceRowsPresent,
        mismatches_found: audit.mismatchesFound,
      },
      legacy_finance_table_present: audit.legacyFinanceTablePresent,
      mismatches: audit.mismatches,
    });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Depreciation tables are not installed." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Failed to run depreciation cutover audit." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleAdminDepreciationCutoverAuditGet(request);
}
