import { NextResponse } from "next/server";

import {
  normalizeAdminSettingsValue,
  resolveVehicleSecurityDepositJmd,
} from "@/lib/adminSettings";
import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

type SettingsRow = {
  content: string | null;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  status: string;
};

const SETTINGS_KEY = "settings";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

function parseStoredSettings(content: unknown) {
  if (typeof content !== "string" || !content.trim()) {
    return normalizeAdminSettingsValue({});
  }

  try {
    return normalizeAdminSettingsValue(JSON.parse(content));
  } catch {
    return normalizeAdminSettingsValue({});
  }
}

async function loadSettings() {
  const result = await dbQuery<SettingsRow>(
    "select content from admin_documents where key = $1 limit 1",
    [SETTINGS_KEY],
  );
  return parseStoredSettings(result.rows[0]?.content);
}

async function saveSettings(content: string, actorUserId: string | null) {
  await dbQuery(
    "insert into admin_documents (key, content, updated_by) values ($1, $2, $3::uuid) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now()",
    [SETTINGS_KEY, content, actorUserId],
  );
}

function normalizeUuid(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return UUID_REGEX.test(normalized) ? normalized : null;
}

function normalizeSecurityDepositJmd(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.round(parsed);
  if (normalized <= 0) return null;
  return Math.min(1000000, normalized);
}

async function loadVehicles() {
  return dbQuery<VehicleRow>(
    "select id, make, model, year, status from vehicles where deleted_at is null order by make asc, model asc, year desc",
  );
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const [settings, vehicles] = await Promise.all([loadSettings(), loadVehicles()]);
    const deposits = vehicles.rows.map((vehicle: VehicleRow) => ({
      vehicleId: vehicle.id,
      securityDepositJmd: resolveVehicleSecurityDepositJmd(settings, vehicle),
    }));
    const vehicleDepositsJmd: Record<string, number | null> = {};
    for (const deposit of deposits) {
      vehicleDepositsJmd[deposit.vehicleId] = deposit.securityDepositJmd;
    }

    return NextResponse.json(
      {
        vehicles: vehicles.rows,
        securityDeposits: {
          vehicleDepositsJmd,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logError("api.admin.security-deposits.GET", error, { userId: actor.userId });
    return NextResponse.json(
      { error: "Failed to load security deposits." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const vehicleId = normalizeUuid(body?.vehicleId);
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required." }, { status: 400 });
  }

  try {
    const vehicleExists = await dbQuery<{ id: string }>(
      "select id from vehicles where id = $1::uuid limit 1",
      [vehicleId],
    );
    if (vehicleExists.rowCount === 0) {
      return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
    }

    const settings = await loadSettings();
    const nextDeposits = {
      ...settings.bookingVehicleSecurityDeposits.vehicleDepositsJmd,
      [vehicleId]: normalizeSecurityDepositJmd(body?.securityDepositJmd),
    };
    const nextSettings = normalizeAdminSettingsValue({
      ...settings,
      bookingVehicleSecurityDeposits: {
        vehicleDepositsJmd: nextDeposits,
      },
    });

    await saveSettings(JSON.stringify(nextSettings), normalizeUuid(actor.userId));
    return NextResponse.json({
      ok: true,
      securityDepositJmd: resolveVehicleSecurityDepositJmd(nextSettings, {
        id: vehicleId,
      }),
    });
  } catch (error) {
    logError("api.admin.security-deposits.PATCH", error, {
      userId: actor.userId,
      vehicleId,
    });
    return NextResponse.json(
      { error: "Failed to save security deposit." },
      { status: 500 },
    );
  }
}
