import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminDepreciationCutoverAuditGet } from "@/app/api/admin/depreciation/cutover-audit/route";

function adminSession() {
  return {
    userId: "admin-user-id",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("admin depreciation cutover audit API: requires auth", async () => {
  const response = await handleAdminDepreciationCutoverAuditGet(
    new Request("http://localhost/api/admin/depreciation/cutover-audit"),
    {
      getSession: async () => null,
      runAudit: async () => ({
        vehiclesTotal: 0,
        profilesPresent: 0,
        profilesMissing: 0,
        profilesInactive: 0,
        legacyFinanceRowsPresent: 0,
        mismatchesFound: 0,
        legacyFinanceTablePresent: false,
        mismatches: [],
      }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin depreciation cutover audit API: returns summary and mismatches", async () => {
  const response = await handleAdminDepreciationCutoverAuditGet(
    new Request("http://localhost/api/admin/depreciation/cutover-audit"),
    {
      getSession: async () => adminSession(),
      runAudit: async () => ({
        vehiclesTotal: 12,
        profilesPresent: 10,
        profilesMissing: 2,
        profilesInactive: 1,
        legacyFinanceRowsPresent: 11,
        mismatchesFound: 3,
        legacyFinanceTablePresent: true,
        mismatches: [
          {
            vehicleId: "11111111-1111-4111-8111-111111111111",
            profilePurchasePriceCents: 120000000,
            legacyPurchasePriceCents: 118000000,
            profileResidualValueCents: 20000000,
            legacyResidualValueCents: 18000000,
            profileUsefulLifeMonths: 60,
            legacyUsefulLifeMonths: 58,
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    counts: {
      vehicles_total: number;
      profiles_present: number;
      profiles_missing: number;
      profiles_inactive: number;
      legacy_finance_rows_present: number;
      mismatches_found: number;
    };
    legacy_finance_table_present: boolean;
    mismatches: Array<{ vehicleId: string }>;
  };

  assert.equal(body.ok, true);
  assert.equal(body.counts.vehicles_total, 12);
  assert.equal(body.counts.profiles_present, 10);
  assert.equal(body.counts.profiles_missing, 2);
  assert.equal(body.counts.profiles_inactive, 1);
  assert.equal(body.counts.legacy_finance_rows_present, 11);
  assert.equal(body.counts.mismatches_found, 3);
  assert.equal(body.legacy_finance_table_present, true);
  assert.equal(body.mismatches[0]?.vehicleId, "11111111-1111-4111-8111-111111111111");
});
