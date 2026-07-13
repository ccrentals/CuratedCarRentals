import assert from "node:assert/strict";
import test from "node:test";

import { getAdminReportsPayload, normalizeReportsFilters } from "@/lib/reports/adminReports";
import type { Queryable } from "@/lib/payments/pricing";

function createMockReportsDb(options?: {
  outstandingRows?: Array<Record<string, unknown>>;
  missingMaintenance?: boolean;
  missingBlockouts?: boolean;
  excludedUnknownTimestampCount?: number;
  queryLog?: string[];
  profitabilityBookingRows?: Array<Record<string, unknown>>;
  profitabilityMaintenanceRows?: Array<Record<string, unknown>>;
  profitabilityVehicleRows?: Array<Record<string, unknown>>;
}): Queryable {
  const config = options ?? {};
  return {
    async query(text: string) {
      config.queryLog?.push(text);

      if (text.includes("from vehicle_maintenance_records")) {
        if (config.missingMaintenance) {
          const error = new Error("relation \"vehicle_maintenance_records\" does not exist") as Error & {
            code?: string;
          };
          error.code = "42P01";
          throw error;
        }
        const rows = config.profitabilityMaintenanceRows ?? [];
        return { rows, rowCount: rows.length };
      }

      if (text.includes("select b.vehicle_id") && text.includes("gross_revenue")) {
        const rows = config.profitabilityBookingRows ?? [];
        return { rows, rowCount: rows.length };
      }

      if (text.includes("select v.id, v.make, v.model, v.status from vehicles")) {
        const rows = config.profitabilityVehicleRows ?? [];
        return { rows, rowCount: rows.length };
      }

      if (text.includes("from blockouts bo")) {
        if (config.missingBlockouts) {
          const error = new Error("relation \"blockouts\" does not exist") as Error & { code?: string };
          error.code = "42P01";
          throw error;
        }
        return { rows: [], rowCount: 0 };
      }

      if (text.includes("with booking_financials as")) {
        const rows = config.outstandingRows ?? [];
        return { rows, rowCount: rows.length };
      }

      if (text.includes("count(*)::int as excluded_count")) {
        return {
          rows: [{ excluded_count: config.excludedUnknownTimestampCount ?? 0 }],
          rowCount: 1,
        };
      }

      if (text.includes("total_customers")) {
        return {
          rows: [{ total_customers: 0, new_customers: 0, repeat_customers: 0 }],
          rowCount: 1,
        };
      }

      if (text.includes("cohort_month")) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes("gross_payments") && text.includes("refund_total")) {
        return { rows: [{ gross_payments: 0, refund_total: 0 }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

test("normalizeReportsFilters: defaults snapshot to today and range to current month", () => {
  const filters = normalizeReportsFilters({});
  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const expectedToday = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
  const expectedMonthStart = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-01`;

  assert.equal(filters.snapshotDate, expectedToday);
  assert.equal(filters.rangeTo, expectedToday);
  assert.equal(filters.rangeFrom, expectedMonthStart);
});

test("getAdminReportsPayload: aging uses pickup due date and section warnings surface degraded inputs", async () => {
  const payload = await getAdminReportsPayload(
    {
      snapshotDate: "2026-03-22",
      rangeFrom: "2026-03-01",
      rangeTo: "2026-03-22",
    },
    {
      db: createMockReportsDb({
        outstandingRows: [
          {
            id: "booking-1",
            public_id: "BK0001",
            status: "CONFIRMED",
            start_date: "2026-03-10",
            end_date: "2026-03-30",
            pricing_json: {},
            customer_name: "Jane Doe",
            vehicle_make: "Toyota",
            vehicle_model: "Yaris",
            total_amount: 1000,
            amount_paid: 750,
            balance_due: 250,
            days_from_pickup: -12,
          },
        ],
        missingMaintenance: true,
        missingBlockouts: true,
        excludedUnknownTimestampCount: 2,
      }),
    },
  );

  assert.equal(payload.agingReceivables.rows[0]?.daysPastDue, 12);
  assert.equal(
    payload.sectionMeta.vehicleProfitability.warnings[0],
    "Maintenance records table not found. Maintenance costs are excluded from this section.",
  );
  assert.equal(
    payload.sectionMeta.utilization.warnings[0],
    "Blockouts table not found. Utilization is based on booked days only.",
  );
  assert.match(payload.sectionMeta.cancellationRefundImpact.warnings[0] ?? "", /2 cancellation or override/);
});

test("getAdminReportsPayload: vehicle filter does not leak into first-booking cohort identity", async () => {
  const queryLog: string[] = [];
  await getAdminReportsPayload(
    {
      snapshotDate: "2026-03-22",
      rangeFrom: "2026-03-01",
      rangeTo: "2026-03-22",
      vehicleId: "veh-1",
    },
    {
      db: createMockReportsDb({ queryLog }),
    },
  );

  const cohortQueries = queryLog.filter((sql) => sql.includes("first_bookings as ("));
  assert.equal(cohortQueries.length >= 2, true);
  for (const sql of cohortQueries) {
    const firstBookingsSegment = sql.split("first_bookings as (")[1] ?? "";
    const firstBookingsUntilGroupBy = firstBookingsSegment.split("group by b.customer_id")[0] ?? "";
    assert.doesNotMatch(firstBookingsUntilGroupBy, /b\.vehicle_id/);
  }

  const outstandingQuery = queryLog.find((sql) => sql.includes("with booking_financials as"));
  assert.match(outstandingQuery ?? "", /b\.created_at::date <= \$1::date/);
  assert.doesNotMatch(outstandingQuery ?? "", /between \$1 and \$2/);
});

test("getAdminReportsPayload: profitability converts maintenance minor units to whole JMD", async () => {
  const payload = await getAdminReportsPayload(
    {
      snapshotDate: "2026-03-22",
      rangeFrom: "2026-03-01",
      rangeTo: "2026-03-22",
    },
    {
      db: createMockReportsDb({
        profitabilityBookingRows: [
          {
            vehicle_id: "veh-1",
            booking_count: 1,
            gross_revenue: 6500,
            refunds: 0,
          },
        ],
        profitabilityMaintenanceRows: [
          { vehicle_id: "veh-1", maintenance_cost: 25000 },
        ],
        profitabilityVehicleRows: [
          { id: "veh-1", make: "Toyota", model: "Aqua", status: "AVAILABLE" },
        ],
      }),
    },
  );

  assert.equal(payload.vehicleProfitability.rows[0]?.maintenanceCost, 250);
  assert.equal(payload.vehicleProfitability.rows[0]?.netProfit, 6250);
});
