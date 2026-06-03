import { NextResponse } from "next/server";

import {
  normalizeAdminSettingsValue,
  normalizeMinimumRentalDays,
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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

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

async function loadVehiclesForMinimumRentalDays() {
  try {
    return await dbQuery<VehicleRow>(
      "select id, make, model, year, status from vehicles where deleted_at is null order by make asc, model asc, year desc",
    );
  } catch (error) {
    if (!isUndefinedColumn(error, "deleted_at")) {
      throw error;
    }

    return await dbQuery<VehicleRow>(
      "select id, make, model, year, status from vehicles order by make asc, model asc, year desc",
    );
  }
}

async function saveSettings(content: string, actorUserId: string | null) {
  await dbQuery(
    "insert into admin_documents (key, content, updated_by) values ($1, $2, $3::uuid) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now()",
    [SETTINGS_KEY, content, actorUserId],
  );
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const [settings, vehicles] = await Promise.all([
      loadSettings(),
      loadVehiclesForMinimumRentalDays(),
    ]);

    return NextResponse.json(
      {
        minimumRentalDays: settings.bookingMinimumRentalDays,
        vehicles: vehicles.rows,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logError("api.admin.minimum-rental-days.GET", error, { userId: actor.userId });
    return NextResponse.json(
      { error: "Failed to load minimum rental days." },
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

  const scope = normalizeText(body?.scope).toUpperCase();
  if (scope !== "GLOBAL" && scope !== "VEHICLE") {
    return NextResponse.json({ error: "scope must be GLOBAL or VEHICLE." }, { status: 400 });
  }

  try {
    const settings = await loadSettings();
    const nextMinimumRentalDays = {
      globalDefaultDays: settings.bookingMinimumRentalDays.globalDefaultDays,
      vehicleOverrides: { ...settings.bookingMinimumRentalDays.vehicleOverrides },
    };

    if (scope === "GLOBAL") {
      nextMinimumRentalDays.globalDefaultDays = normalizeMinimumRentalDays(body?.minimumDays);
    } else {
      const vehicleId = normalizeText(body?.vehicleId);
      if (!UUID_REGEX.test(vehicleId)) {
        return NextResponse.json({ error: "A valid vehicleId is required." }, { status: 400 });
      }

      const vehicleExists = await dbQuery<{ id: string }>(
        "select id from vehicles where id = $1 limit 1",
        [vehicleId],
      );
      if (vehicleExists.rowCount === 0) {
        return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
      }

      if (body?.inheritGlobal === true) {
        delete nextMinimumRentalDays.vehicleOverrides[vehicleId];
      } else {
        nextMinimumRentalDays.vehicleOverrides[vehicleId] = normalizeMinimumRentalDays(
          body?.minimumDays,
        );
      }
    }

    const nextSettings = normalizeAdminSettingsValue({
      ...settings,
      bookingMinimumRentalDays: nextMinimumRentalDays,
    });
    await saveSettings(JSON.stringify(nextSettings), actor.userId);
    return NextResponse.json({
      ok: true,
      minimumRentalDays: nextSettings.bookingMinimumRentalDays,
    });
  } catch (error) {
    logError("api.admin.minimum-rental-days.PATCH", error, {
      userId: actor.userId,
      scope,
    });
    return NextResponse.json(
      { error: "Failed to save minimum rental days." },
      { status: 500 },
    );
  }
}
