import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRevenueBarWidthPercent,
  summarizeOutstandingBalanceRows,
  summarizeRevenuePoints,
  type RevenuePoint,
} from "@/lib/reports/adminReports";

test("summarizeRevenuePoints: aggregates gross/refunds/net and counts from fixtures", () => {
  const points: RevenuePoint[] = [
    {
      periodStart: "2026-02-01",
      periodLabel: "2026-02-01",
      grossRevenue: 100_000,
      refunds: 5_000,
      netRevenue: 95_000,
      paymentCount: 4,
      fallbackBookingCount: 1,
      fallbackRevenue: 15_000,
    },
    {
      periodStart: "2026-02-02",
      periodLabel: "2026-02-02",
      grossRevenue: 200_000,
      refunds: 10_000,
      netRevenue: 190_000,
      paymentCount: 8,
      fallbackBookingCount: 2,
      fallbackRevenue: 20_000,
    },
  ];

  const totals = summarizeRevenuePoints(points);
  assert.deepEqual(totals, {
    grossRevenue: 300_000,
    refunds: 15_000,
    netRevenue: 285_000,
    paymentCount: 12,
    fallbackBookingCount: 3,
  });
});

test("summarizeOutstandingBalanceRows: totals and count match fixture rows", () => {
  const totals = summarizeOutstandingBalanceRows([
    { balanceDue: 10_000 },
    { balanceDue: 500 },
    { balanceDue: 0 },
  ]);

  assert.deepEqual(totals, {
    totalOutstandingAmount: 10_500,
    outstandingCount: 3,
  });
});

test("normalizeRevenueBarWidthPercent: values are normalized against max", () => {
  const max = 100;
  const widths = [10, 50, 100].map((value) => normalizeRevenueBarWidthPercent(value, max));
  assert.deepEqual(widths, [10, 50, 100]);
  assert.equal(normalizeRevenueBarWidthPercent(0, max), 0);
});
