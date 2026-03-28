import assert from "node:assert/strict";
import test from "node:test";

import { handleReportsGet } from "@/app/api/admin/reports/route";
import type { AdminReportsPayload } from "@/lib/reports/adminReports";

const mockPayload: AdminReportsPayload = {
  filters: {
    snapshotDate: "2026-02-14",
    rangeFrom: "2026-02-01",
    rangeTo: "2026-02-28",
    vehicleId: "",
    revenueGranularity: "day",
  },
  generatedAt: "2026-02-14T15:00:00.000Z",
  sectionMeta: {
    revenue: {
      mode: "historical",
      dateBasisLabel: "By payment date",
      supportsExport: true,
      warnings: [],
    },
    vehicleProfitability: {
      mode: "historical",
      dateBasisLabel: "By booking overlap",
      supportsExport: true,
      warnings: [],
    },
    utilization: {
      mode: "historical",
      dateBasisLabel: "By booking overlap",
      supportsExport: true,
      warnings: ["Blockouts table not found. Utilization is based on booked days only."],
    },
    outstandingBalances: {
      mode: "operational",
      dateBasisLabel: "As of snapshot date",
      supportsExport: true,
      warnings: [],
    },
    agingReceivables: {
      mode: "operational",
      dateBasisLabel: "Aged from pickup due date as of snapshot date",
      supportsExport: true,
      warnings: [],
    },
    customerCohort: {
      mode: "historical",
      dateBasisLabel: "By booking created date",
      supportsExport: true,
      warnings: [],
    },
    locationPerformance: {
      mode: "historical",
      dateBasisLabel: "By pickup date",
      supportsExport: true,
      warnings: [],
    },
    funnel: {
      mode: "historical",
      dateBasisLabel: "By booking created date",
      supportsExport: true,
      warnings: [],
    },
    upcoming: {
      mode: "operational",
      dateBasisLabel: "By pickup and return date",
      supportsExport: true,
      warnings: [],
    },
    cancellationRefundImpact: {
      mode: "historical",
      dateBasisLabel: "Cancellations by canonical event date; refunds by payment date",
      supportsExport: true,
      warnings: ["1 cancellation or override record(s) were excluded because no canonical event timestamp was found."],
    },
  },
  revenue: {
    granularity: "day",
    totals: {
      grossRevenue: 1000,
      refunds: 100,
      netRevenue: 900,
      paymentCount: 2,
    },
    points: [
      {
        periodStart: "2026-02-10",
        periodLabel: "Feb 10, 2026",
        grossRevenue: 1000,
        refunds: 100,
        netRevenue: 900,
        paymentCount: 2,
      },
    ],
  },
  vehicleProfitability: {
    totals: {
      vehicleCount: 1,
      grossRevenue: 1000,
      refunds: 100,
      maintenanceCost: 250,
      netProfit: 650,
    },
    includesMaintenanceData: true,
    rows: [
      {
        vehicleId: "veh-1",
        vehicleLabel: "Toyota Yaris",
        bookingCount: 2,
        grossRevenue: 1000,
        refunds: 100,
        maintenanceCost: 250,
        netProfit: 650,
        marginPercent: 65,
      },
    ],
  },
  utilization: {
    rangeDays: 28,
    includesBlockouts: false,
    rows: [
      {
        vehicleId: "veh-1",
        vehicleLabel: "Toyota Yaris",
        bookedDays: 8,
        availableDays: 20,
        blockoutDays: 0,
        utilizationPercent: 40,
      },
    ],
  },
  outstandingBalances: {
    totals: {
      totalOutstandingAmount: 250,
      outstandingCount: 1,
    },
    rows: [
      {
        bookingDbId: "booking-1",
        bookingId: "BK0001",
        customerName: "Jane Doe",
        vehicleLabel: "Toyota Yaris",
        pickupDate: "2026-02-12",
        returnDate: "2026-02-14",
        status: "CONFIRMED",
        paymentOption: "CARD",
        paymentStatus: "PARTIALLY_PAID",
        isNonBlocking: false,
        total: 1000,
        amountPaid: 750,
        balanceDue: 250,
        daysFromPickup: -2,
      },
    ],
  },
  agingReceivables: {
    totals: {
      totalOutstandingAmount: 250,
      outstandingCount: 1,
      overdueAmount: 250,
      overdueCount: 1,
    },
    buckets: [
      { label: "Current", count: 0, amount: 0 },
      { label: "1-15 days", count: 1, amount: 250 },
      { label: "16-30 days", count: 0, amount: 0 },
      { label: "30+ days", count: 0, amount: 0 },
    ],
    rows: [
      {
        bookingDbId: "booking-1",
        bookingId: "BK0001",
        customerName: "Jane Doe",
        vehicleLabel: "Toyota Yaris",
        pickupDate: "2026-02-12",
        returnDate: "2026-02-14",
        balanceDue: 250,
        daysPastDue: 2,
        bucket: "1-15 days",
      },
    ],
  },
  customerCohort: {
    summary: {
      totalCustomers: 3,
      newCustomers: 2,
      repeatCustomers: 1,
      repeatRate: 33.3,
    },
    rows: [
      {
        cohortMonth: "2026-02-01",
        cohortLabel: "Feb 2026",
        customerCount: 3,
        bookingCount: 4,
        revenue: 1000,
      },
    ],
  },
  locationPerformance: {
    totals: {
      bookingCount: 2,
      revenue: 1000,
      amountPaid: 750,
      outstanding: 250,
      cancellationCount: 0,
    },
    rows: [
      {
        locationLabel: "Kingston",
        bookingCount: 2,
        revenue: 1000,
        amountPaid: 750,
        outstanding: 250,
        cancellationCount: 0,
      },
    ],
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
    excludedUnknownTimestampCount: 1,
  },
};

const adminSession = {
  userId: "admin-id",
  role: "ADMIN" as const,
  expiresAt: 9999999999,
  issuedAt: 9999999000,
};

test("admin reports API: returns report payload shape for authorized admin", async () => {
  const response = await handleReportsGet(
    new Request("http://localhost/api/admin/reports?snapshotDate=2026-02-14&rangeFrom=2026-02-01&rangeTo=2026-02-28"),
    {
      getSession: async () => adminSession,
      getPayload: async () => mockPayload,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    report?: AdminReportsPayload;
    filters?: AdminReportsPayload["filters"];
  };
  assert.equal(body.ok, true);
  assert.equal(body.filters?.snapshotDate, "2026-02-14");
  assert.equal(body.filters?.rangeFrom, "2026-02-01");
  assert.equal(body.filters?.rangeTo, "2026-02-28");
  assert.equal(body.report?.sectionMeta.revenue.mode, "historical");
  assert.equal(body.report?.sectionMeta.outstandingBalances.mode, "operational");
});

test("admin reports API: supports cash collections CSV export with metadata", async () => {
  const response = await handleReportsGet(
    new Request(
      "http://localhost/api/admin/reports?snapshotDate=2026-02-14&rangeFrom=2026-02-01&rangeTo=2026-02-28&format=csv&report=cash_collections",
    ),
    {
      getSession: async () => adminSession,
      getPayload: async () => mockPayload,
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/i);
  const csv = await response.text();
  assert.match(csv, /# Cash Collections by Period/);
  assert.match(csv, /# Mode: Historical analysis/);
  assert.match(csv, /Period,Gross Collections,Refunds,Net Collections,Payments/);
});

test("admin reports API: supports styled excel export with warnings", async () => {
  const response = await handleReportsGet(
    new Request(
      "http://localhost/api/admin/reports?snapshotDate=2026-02-14&rangeFrom=2026-02-01&rangeTo=2026-02-28&format=excel&report=vehicle_utilization",
    ),
    {
      getSession: async () => adminSession,
      getPayload: async () => mockPayload,
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/vnd\.ms-excel/i);
  const xml = await response.text();
  assert.match(xml, /Vehicle Utilization/i);
  assert.match(xml, /Summary/i);
  assert.match(xml, /Blockouts table not found/i);
});

test("admin reports API: supports branded PDF export", async () => {
  const response = await handleReportsGet(
    new Request(
      "http://localhost/api/admin/reports?snapshotDate=2026-02-14&rangeFrom=2026-02-01&rangeTo=2026-02-28&format=pdf&report=outstanding_balances",
    ),
    {
      getSession: async () => adminSession,
      getPayload: async () => mockPayload,
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/pdf/i);
  const body = await response.arrayBuffer();
  const prefix = Buffer.from(body).subarray(0, 8).toString("ascii");
  assert.match(prefix, /^%PDF-1\./);
});

test("admin reports API: rejects unsupported export format", async () => {
  const response = await handleReportsGet(
    new Request(
      "http://localhost/api/admin/reports?snapshotDate=2026-02-14&rangeFrom=2026-02-01&rangeTo=2026-02-28&format=jsonl&report=cash_collections",
    ),
    {
      getSession: async () => adminSession,
      getPayload: async () => mockPayload,
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.match(body.error ?? "", /Invalid format/i);
});
