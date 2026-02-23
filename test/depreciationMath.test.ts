import assert from "node:assert/strict";
import test from "node:test";

import {
  computeBookValueAtMonth,
  computeStraightLineMonthly,
  generateSnapshots,
} from "@/lib/vehicles/depreciation";

test("depreciation math: straight-line monthly uses integer cents", () => {
  const monthly = computeStraightLineMonthly(2_500_000_00, 500_000_00, 60);
  assert.equal(monthly, 3_333_333);
});

test("depreciation math: book value computes for target month", () => {
  const result = computeBookValueAtMonth(
    {
      purchaseDate: "2026-01-10",
      purchaseCostCents: 1_200_000_00,
      residualValueCents: 200_000_00,
      usefulLifeMonths: 50,
      depreciationMethod: "STRAIGHT_LINE",
    },
    "2026-03-01",
  );

  if ("incompleteReason" in result) {
    assert.fail(`unexpected incomplete reason: ${result.incompleteReason}`);
  }

  assert.equal(result.asOfMonth, "2026-03-01");
  assert.equal(result.monthlyDepreciationCents, 2_000_000);
  assert.equal(result.accumulatedDepreciationCents, 6_000_000);
  assert.equal(result.bookValueCents, 114_000_000);
});

test("depreciation math: month before purchase has zero depreciation", () => {
  const result = computeBookValueAtMonth(
    {
      purchaseDate: "2026-05-05",
      purchaseCostCents: 500_000_00,
      residualValueCents: 100_000_00,
      usefulLifeMonths: 40,
      depreciationMethod: "STRAIGHT_LINE",
    },
    "2026-04-01",
  );

  if ("incompleteReason" in result) {
    assert.fail(`unexpected incomplete reason: ${result.incompleteReason}`);
  }

  assert.equal(result.depreciationForMonthCents, 0);
  assert.equal(result.accumulatedDepreciationCents, 0);
  assert.equal(result.bookValueCents, 50_000_000);
});

test("depreciation math: generate snapshots validates complete finance input", () => {
  const generated = generateSnapshots(
    "11111111-1111-4111-8111-111111111111",
    "2026-01-01",
    "2026-06-01",
    {
      purchaseDate: "",
      purchaseCostCents: null,
      residualValueCents: null,
      usefulLifeMonths: null,
      depreciationMethod: null,
    },
  );

  assert.equal(generated.snapshots.length, 0);
  assert.equal(generated.incompleteReason, "Purchase date is required.");
});

test("depreciation math: generate snapshots returns expected month count", () => {
  const generated = generateSnapshots(
    "11111111-1111-4111-8111-111111111111",
    "2026-01-01",
    "2026-12-01",
    {
      purchaseDate: "2026-01-01",
      purchaseCostCents: 600_000_00,
      residualValueCents: 120_000_00,
      usefulLifeMonths: 48,
      depreciationMethod: "STRAIGHT_LINE",
    },
  );

  assert.equal(generated.incompleteReason, null);
  assert.equal(generated.snapshots.length, 12);
  assert.equal(generated.snapshots[0]?.asOfMonth, "2026-01-01");
  assert.equal(generated.snapshots[11]?.asOfMonth, "2026-12-01");
});
