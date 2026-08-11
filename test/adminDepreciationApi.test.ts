import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminDepreciationGet } from "@/app/api/admin/depreciation/implementation";
import { handleAdminDepreciationExportGet } from "@/app/api/admin/depreciation/export/implementation";

test("admin depreciation API: list requires auth", async () => {
  const response = await handleAdminDepreciationGet(
    new Request("http://localhost/api/admin/depreciation"),
    {
      getSession: async () => null,
      listReport: async () => ({ asOfMonth: "2026-02-01", items: [] }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin depreciation API: list returns report payload", async () => {
  const response = await handleAdminDepreciationGet(
    new Request(
      "http://localhost/api/admin/depreciation?asOfMonth=2026-02&sortBy=bookValue&sortDir=desc",
    ),
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      listReport: async () => ({
        asOfMonth: "2026-02-01",
        items: [
          {
            vehicleId: "11111111-1111-4111-8111-111111111111",
            make: "Honda",
            model: "Fit",
            year: 2020,
            vehicleType: "Hatchback",
            vehicleClass: "Economy",
            purchaseDate: "2026-01-01",
            purchaseCostCents: 900_000_00,
            residualValueCents: 200_000_00,
            usefulLifeMonths: 60,
            depreciationMethod: "STRAIGHT_LINE",
            notes: null,
            asOfMonth: "2026-02-01",
            monthlyDepreciationCents: 11_666_66,
            bookValueCents: 888_333_34,
            accumulatedDepreciationCents: 11_666_66,
            incompleteReason: null,
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    asOfMonth: string;
    items: Array<{ vehicleId: string }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.asOfMonth, "2026-02-01");
  assert.equal(body.items[0]?.vehicleId, "11111111-1111-4111-8111-111111111111");
});

test("admin depreciation export API: requires auth", async () => {
  const response = await handleAdminDepreciationExportGet(
    new Request("http://localhost/api/admin/depreciation/export"),
    {
      getSession: async () => null,
      listReport: async () => ({ asOfMonth: "2026-02-01", items: [] }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin depreciation export API: returns CSV", async () => {
  const response = await handleAdminDepreciationExportGet(
    new Request("http://localhost/api/admin/depreciation/export?asOfMonth=2026-02"),
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      listReport: async () => ({
        asOfMonth: "2026-02-01",
        items: [
          {
            vehicleId: "11111111-1111-4111-8111-111111111111",
            make: "Honda",
            model: "Fit",
            year: 2020,
            vehicleType: "Hatchback",
            vehicleClass: "Economy",
            purchaseDate: "2026-01-01",
            purchaseCostCents: 900_000_00,
            residualValueCents: 200_000_00,
            usefulLifeMonths: 60,
            depreciationMethod: "STRAIGHT_LINE",
            notes: null,
            asOfMonth: "2026-02-01",
            monthlyDepreciationCents: 11_666_66,
            bookValueCents: 888_333_34,
            accumulatedDepreciationCents: 11_666_66,
            incompleteReason: null,
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.match(csv, /vehicle_id,vehicle,vehicle_type/);
  assert.match(csv, /11111111-1111-4111-8111-111111111111/);
  assert.match(csv, /2020 Honda Fit/);
});
