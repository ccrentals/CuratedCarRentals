import { NextResponse } from "next/server";

import { loadAdminSettings } from "@/lib/adminSettings";
import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { listBlockouts } from "@/lib/blockouts/shared";
import {
  buildCalendarBookingStatusClauses,
  sanitizeCalendarVehicleId,
  type CalendarVehicleOption,
} from "@/lib/bookings/adminCalendar";
import { buildBookingRangeWhere } from "@/lib/bookings/dateRangeFilter";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type CalendarView = "week" | "month";

type CalendarBookingRow = {
  id: string;
  public_id: string | null;
  status: string;
  archived_at: string | null;
  start_at: string | null;
  end_at: string | null;
  start_date: string;
  end_date: string;
  created_at: string;
  pickup_location: string;
  customer_name: string;
  customer_email: string;
  vehicle_id: string;
  vehicle_make: string;
  vehicle_model: string;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string | null) {
  if (!value || !DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function buildAdminCalendarWindow(input: { date?: string | null; view?: string | null; now?: Date }) {
  const view: CalendarView = input.view === "week" ? "week" : "month";
  const now = input.now ?? new Date();
  const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  const base = parseDateOnly(input.date ?? null) ?? fallback;
  const rangeStart = new Date(base);

  if (view === "month") {
    rangeStart.setUTCDate(1);
  }
  rangeStart.setUTCDate(rangeStart.getUTCDate() - rangeStart.getUTCDay());

  const rangeEnd = view === "week"
    ? addUtcDays(rangeStart, 6)
    : (() => {
        const monthEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 12));
        return addUtcDays(monthEnd, 6 - monthEnd.getUTCDay());
      })();

  const days: string[] = [];
  for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addUtcDays(cursor, 1)) {
    days.push(dateKey(cursor));
  }

  return {
    view,
    baseDate: dateKey(base),
    rangeStart: dateKey(rangeStart),
    rangeEnd: dateKey(rangeEnd),
    rangeStartIso: `${dateKey(rangeStart)}T00:00:00.000Z`,
    rangeEndIso: `${dateKey(rangeEnd)}T23:59:59.999Z`,
    days,
  };
}

export async function GET(request: Request) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const window = buildAdminCalendarWindow({ date: params.get("date"), view: params.get("view") });
  const requestedVehicleId = params.get("vehicleId") || undefined;
  const statusParam = params.get("status");

  try {
    const vehicles = await dbQuery<CalendarVehicleOption>(
      "select id, make, model from vehicles where deleted_at is null order by make, model",
    );
    const vehicleId = sanitizeCalendarVehicleId(requestedVehicleId, vehicles.rows);
    const rangeWhere = buildBookingRangeWhere({
      rangeStart: window.rangeStartIso,
      rangeEnd: window.rangeEndIso,
      bookingAlias: "b",
    });
    const clauses = [rangeWhere.clause];
    const values: string[] = [...rangeWhere.values];
    let paramIndex = rangeWhere.nextParamIndex;

    if (vehicleId) {
      clauses.push(`b.vehicle_id = $${paramIndex}`);
      values.push(vehicleId);
      paramIndex += 1;
    }

    const status = buildCalendarBookingStatusClauses({
      statusParam,
      paramStartIndex: paramIndex,
      bookingAlias: "b",
    });
    clauses.push(...status.clauses);
    values.push(...status.values);

    const bookings = await dbQuery<CalendarBookingRow>(
      "select b.id, b.public_id, b.status, b.archived_at, b.start_at, b.end_at, b.start_date, b.end_date, b.created_at, b.pickup_location, c.full_name as customer_name, c.email as customer_email, v.id as vehicle_id, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where " +
        clauses.join(" and ") +
        " order by coalesce(b.start_at, b.start_date::timestamptz) asc",
      values,
    );

    const warnings: string[] = [];
    let blockouts: Awaited<ReturnType<typeof listBlockouts>> = [];
    try {
      blockouts = await listBlockouts({
        rangeStartIso: window.rangeStartIso,
        rangeEndIso: window.rangeEndIso,
        vehicleId,
      });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "42P01") throw error;
      warnings.push("Blockouts are unavailable because the blockouts table is not installed.");
    }

    const { settings } = await loadAdminSettings();
    return NextResponse.json({
      ...window,
      selectedVehicleId: vehicleId ?? null,
      selectedStatus: status.selectedStatus,
      dayViewBookingLimit: settings.dayViewBookingLimit,
      vehicles: vehicles.rows,
      bookings: bookings.rows,
      blockouts,
      warnings,
    });
  } catch (error) {
    logError("api.admin.calendar.GET", error, {
      userId: auth.actor.userId,
      date: window.baseDate,
      view: window.view,
      vehicleId: requestedVehicleId,
      status: statusParam,
    });
    return NextResponse.json({ error: "Failed to load calendar" }, { status: 500 });
  }
}
