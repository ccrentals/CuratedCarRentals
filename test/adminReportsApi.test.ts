import assert from "node:assert/strict";
import test from "node:test";

import { handleReportsGet } from "@/app/api/admin/reports/route";
import type { AdminReportsPayload } from "@/lib/reports/adminReports";

const mockPayload: AdminReportsPayload = {
  filters: {
    dateFrom: "2026-02-01",
    dateTo: "2026-02-28",
    vehicleId: "",
    revenueGranularity: "day",
  },
  generatedAt: "2026-02-14T00:00:00.000Z",
  revenue: {
    granularity: "day",
    totals: {
      grossRevenue: 1000,
      refunds: 100,
      netRevenue: 900,
      paymentCount: 2,
      fallbackBookingCount: 0,
    },
    points: [],
  },
  utilization: {
    rangeDays: 28,
    includesBlockouts: true,
    rows: [],
  },
  outstandingBalances: {
    totals: {
      totalOutstandingAmount: 250,
      outstandingCount: 1,
    },
    rows: [],
  },
  funnel: {
    counts: {
      pendingPayment: 1,
      confirmedActive: 2,
      completedReturned: 1,
      cancelled: 0,
      overridden: 0,
      totalCreated: 4,
    },
    conversion: {
      pendingToConfirmed: 100,
      confirmedToCompleted: 50,
      cancellationRate: 0,
    },
  },
  upcoming: {
    pickups: [],
    returns: [],
  },
  cancellationRefundImpact: {
    summary: {
      cancelledCount: 0,
      refundCount: 1,
      refundTotal: 100,
      grossPayments: 1000,
      netImpact: 900,
    },
    breakdown: [],
    cancellations: [],
    refunds: [],
  },
};

test("admin reports API: returns report payload shape for authorized admin", async () => {
  const response = await handleReportsGet(
    new Request("http://localhost/api/admin/reports?dateFrom=2026-02-01&dateTo=2026-02-28"),
    {
      getSession: async () => ({
        userId: "admin-id",
        role: "ADMIN",
        expiresAt: 9999999999,
        issuedAt: 9999999000,
      }),
      getPayload: async () => mockPayload,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    report?: AdminReportsPayload;
  };
  assert.equal(body.ok, true);
  assert.ok(body.report);
  assert.ok(body.report?.revenue);
  assert.ok(body.report?.utilization);
  assert.ok(body.report?.outstandingBalances);
  assert.ok(body.report?.funnel);
  assert.ok(body.report?.upcoming);
  assert.ok(body.report?.cancellationRefundImpact);
});
