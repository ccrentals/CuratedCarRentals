import { NextResponse } from "next/server";

import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  listUpcomingMaintenance,
  type MaintenanceDueState,
  type MaintenanceRecordCategory,
  type MaintenanceRecordStatus,
} from "@/lib/vehicles/maintenance";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

function parseCsv(input: string | null) {
  if (!input) return [];
  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeStatus(value: string): MaintenanceRecordStatus | null {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "SCHEDULED" ||
    normalized === "IN_PROGRESS" ||
    normalized === "COMPLETED" ||
    normalized === "CANCELLED"
  ) {
    return normalized;
  }
  return null;
}

function normalizeCategory(value: string): MaintenanceRecordCategory | null {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "SERVICE" ||
    normalized === "REPAIR" ||
    normalized === "INSPECTION" ||
    normalized === "REGISTRATION" ||
    normalized === "INSURANCE" ||
    normalized === "TIRE" ||
    normalized === "BRAKE" ||
    normalized === "BATTERY" ||
    normalized === "OTHER"
  ) {
    return normalized;
  }
  return null;
}

function normalizeDueState(value: string): MaintenanceDueState | null {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "OVERDUE" ||
    normalized === "DUE_SOON" ||
    normalized === "UPCOMING" ||
    normalized === "COMPLETED" ||
    normalized === "CANCELLED"
  ) {
    return normalized;
  }
  return null;
}

type Deps = {
  getSession: () => Promise<AdminSession | null>;
  list: typeof listUpcomingMaintenance;
};

const DEFAULT_DEPS: Deps = {
  getSession: () => getSessionFromRequest(),
  list: listUpcomingMaintenance,
};

export async function handleAdminMaintenanceGet(request: Request, deps: Deps = DEFAULT_DEPS) {
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const vehicleId = (searchParams.get("vehicleId") ?? "").trim() || null;
  const from = (searchParams.get("from") ?? "").trim() || null;
  const to = (searchParams.get("to") ?? "").trim() || null;
  const status = parseCsv(searchParams.get("status"))
    .map((value) => normalizeStatus(value))
    .filter((value): value is MaintenanceRecordStatus => Boolean(value));
  const category = parseCsv(searchParams.get("category"))
    .map((value) => normalizeCategory(value))
    .filter((value): value is MaintenanceRecordCategory => Boolean(value));
  const dueState = parseCsv(searchParams.get("dueState"))
    .map((value) => normalizeDueState(value))
    .filter((value): value is MaintenanceDueState => Boolean(value));

  const onlyActive = searchParams.get("onlyActive") !== "0";

  try {
    let items = await deps.list({
      vehicleId,
      status,
      category,
      dueState,
      dateFrom: from,
      dateTo: to,
      onlyActive,
    });

    if (q) {
      items = items.filter((item) => {
        const haystack = `${item.vehicleLabel} ${item.title} ${item.category} ${item.status} ${item.dueState}`.toLowerCase();
        return haystack.includes(q);
      });
    }

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Maintenance tables are not installed." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "Failed to load maintenance list." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminMaintenanceGet(request);
}
