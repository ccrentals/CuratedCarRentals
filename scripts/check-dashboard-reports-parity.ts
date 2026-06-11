#!/usr/bin/env tsx

import path from "node:path";

import dotenv from "dotenv";

import { dbQuery } from "../src/lib/db";
import { getAdminReportsPayload } from "../src/lib/reports/adminReports";

type DashboardOutstandingRow = {
  id: string;
  public_id: string | null;
  balance_due: string;
};

type ParitySnapshot = {
  count: number;
  total: number;
  byBookingId: Map<string, number>;
};

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function toBookingKey(publicId: string | null | undefined, id: string) {
  const normalized = String(publicId ?? "").trim();
  return normalized.length > 0 ? normalized : id;
}

function toRoundedMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

async function fetchDashboardOutstandingAllTime(): Promise<ParitySnapshot> {
  const result = await dbQuery<DashboardOutstandingRow>(
    "with booking_financials as (" +
      "  select b.id, b.public_id, b.created_at, " +
      "    greatest(0, " +
      "      coalesce(" +
      "        case when coalesce(b.pricing_json->>'total_cents', '') ~ '^-?[0-9]+(\\\\.[0-9]+)?$' then (b.pricing_json->>'total_cents')::numeric else null end, " +
      "        coalesce(" +
      "          case when coalesce(b.pricing_json->>'subtotal_cents', '') ~ '^-?[0-9]+(\\\\.[0-9]+)?$' then (b.pricing_json->>'subtotal_cents')::numeric else null end, " +
      "          (v.daily_rate_cents::numeric * greatest((b.end_date - b.start_date), 1))" +
      "        ) - coalesce(" +
      "          case when coalesce(b.pricing_json->>'promo_discount_cents', '') ~ '^-?[0-9]+(\\\\.[0-9]+)?$' then (b.pricing_json->>'promo_discount_cents')::numeric else 0 end, " +
      "          0" +
      "        )" +
      "      ) - coalesce((" +
      "        select sum(p.deposit_amount_cents)::numeric from payments p " +
      "        where p.booking_id = b.id and p.deleted_at is null and p.status = any(array['DEPOSIT_PAID','SUCCESS','REFUNDED']::text[])" +
      "      ), 0)" +
      "    ) as balance_due " +
      "  from bookings b " +
      "  join vehicles v on v.id = b.vehicle_id " +
      "  where b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = ''" +
      ") " +
      "select id, public_id, balance_due::text as balance_due from booking_financials where balance_due > 0",
  );

  const byBookingId = new Map<string, number>();
  let total = 0;
  for (const row of result.rows) {
    const bookingKey = toBookingKey(row.public_id, row.id);
    const balanceDue = toRoundedMoney(Number(row.balance_due ?? 0));
    byBookingId.set(bookingKey, balanceDue);
    total += balanceDue;
  }

  return {
    count: result.rows.length,
    total: toRoundedMoney(total),
    byBookingId,
  };
}

async function fetchReportsOutstandingSnapshot(): Promise<
  ParitySnapshot & { snapshotDate: string; rangeFrom: string; rangeTo: string }
> {
  const payload = await getAdminReportsPayload({});
  const byBookingId = new Map<string, number>();
  let total = 0;

  for (const row of payload.outstandingBalances.rows) {
    const amount = toRoundedMoney(row.balanceDue);
    byBookingId.set(row.bookingId, amount);
    total += amount;
  }

  return {
    count: payload.outstandingBalances.rows.length,
    total: toRoundedMoney(total),
    byBookingId,
    snapshotDate: payload.filters.snapshotDate,
    rangeFrom: payload.filters.rangeFrom,
    rangeTo: payload.filters.rangeTo,
  };
}

function computeAmountDiffs(
  dashboard: Map<string, number>,
  reports: Map<string, number>,
): Array<{ bookingId: string; dashboard: number; reports: number }> {
  const keys = new Set([...dashboard.keys(), ...reports.keys()]);
  const diffs: Array<{ bookingId: string; dashboard: number; reports: number }> = [];
  for (const key of keys) {
    const dashboardAmount = toRoundedMoney(dashboard.get(key) ?? 0);
    const reportsAmount = toRoundedMoney(reports.get(key) ?? 0);
    if (dashboardAmount !== reportsAmount) {
      diffs.push({
        bookingId: key,
        dashboard: dashboardAmount,
        reports: reportsAmount,
      });
    }
  }
  return diffs.sort((a, b) => Math.abs(b.dashboard - b.reports) - Math.abs(a.dashboard - a.reports));
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  const dashboard = await fetchDashboardOutstandingAllTime();
  const reports = await fetchReportsOutstandingSnapshot();

  const dashboardOnly = [...dashboard.byBookingId.keys()].filter((key) => !reports.byBookingId.has(key));
  const reportsOnly = [...reports.byBookingId.keys()].filter((key) => !dashboard.byBookingId.has(key));
  const amountDiffs = computeAmountDiffs(dashboard.byBookingId, reports.byBookingId);
  const countMatches = dashboard.count === reports.count;
  const totalMatches = dashboard.total === reports.total;
  const idsMatch = dashboardOnly.length === 0 && reportsOnly.length === 0;
  const amountsMatch = amountDiffs.length === 0;
  const passed = countMatches && totalMatches && idsMatch && amountsMatch;

  const summary = {
    passed,
    dashboard: {
      count: dashboard.count,
      total: dashboard.total,
    },
    reports: {
      count: reports.count,
      total: reports.total,
      snapshotDate: reports.snapshotDate,
      rangeFrom: reports.rangeFrom,
      rangeTo: reports.rangeTo,
    },
    mismatch: {
      countDelta: dashboard.count - reports.count,
      totalDelta: toRoundedMoney(dashboard.total - reports.total),
      dashboardOnlyCount: dashboardOnly.length,
      reportsOnlyCount: reportsOnly.length,
      amountDiffCount: amountDiffs.length,
      dashboardOnlySample: dashboardOnly.slice(0, 10),
      reportsOnlySample: reportsOnly.slice(0, 10),
      amountDiffSample: amountDiffs.slice(0, 10),
    },
  };

  if (!passed) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Dashboard/Reports parity check failed: ${message}`);
  process.exit(1);
});
