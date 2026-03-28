import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { isNonEmptyString, parseIntSafe, parseMoneyToCents, parseImageUrls } from "@/lib/validators";
import { requireCsrf } from "@/lib/security/csrf";

const allowedStatuses = ["AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "INACTIVE"];
const INVALID_SEAT_COUNT = Symbol("INVALID_SEAT_COUNT");

function validateStatus(value: unknown) {
  return typeof value === "string" && allowedStatuses.includes(value);
}

function parseFeaturesInput(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function toNumberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

function toBooleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeSeatCount(value: unknown): number | null | typeof INVALID_SEAT_COUNT {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return INVALID_SEAT_COUNT;
  if (parsed < 1 || parsed > 60) return INVALID_SEAT_COUNT;
  return parsed;
}

type AdminVehiclesGetDeps = {
  getSession: () => Promise<AdminSession | null>;
  listVehicles: (options: { includeDeleted: boolean }) => Promise<
    Array<{
      id: string;
      public_id: string;
      make: string;
      model: string;
      year: number;
      seat_count: number | null;
      daily_rate_cents: number;
      deposit_cents: number;
      status: string;
      created_at: string;
      deleted_at: string | null;
    }>
  >;
};

const DEFAULT_GET_DEPS: AdminVehiclesGetDeps = {
  getSession: () => getSessionFromRequest(),
  listVehicles: async ({ includeDeleted }) => {
    const whereClause = includeDeleted ? "where deleted_at is not null" : "where deleted_at is null";
    const result = await dbQuery(
      `select id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, created_at, deleted_at
       from vehicles
       ${whereClause}
       order by created_at desc`,
    );
    return result.rows;
  },
};

export async function handleAdminVehiclesGet(
  request: Request,
  deps: AdminVehiclesGetDeps = DEFAULT_GET_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "1";
  const vehicles = await deps.listVehicles({ includeDeleted });
  return NextResponse.json({ vehicles });
}

export async function GET(request: Request) {
  return handleAdminVehiclesGet(request);
}

export async function POST(request: Request) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    form.forEach((value, key) => {
      body[key] = value.toString();
    });
  }

  if (!(await requireCsrf(request, (body?.csrfToken as string) ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const make = body.make;
  const model = body.model;
  const year = parseIntSafe(body.year);
  const dailyRate =
    body.daily_rate_cents !== undefined
      ? parseIntSafe(body.daily_rate_cents)
      : parseMoneyToCents(body.daily_rate_jmd ?? body.daily_rate);
  const deposit =
    body.deposit_cents !== undefined
      ? parseIntSafe(body.deposit_cents)
      : parseMoneyToCents(body.deposit_jmd ?? body.deposit);
  const status = body.status ?? "AVAILABLE";
  const imageUrls = parseImageUrls(body.image_urls_json);
  const parsedFeatures = parseFeaturesInput(body.features_json);
  const seatCount = normalizeSeatCount(body.seat_count ?? body.seatCount ?? parsedFeatures.seats);

  const currentYear = new Date().getFullYear() + 1;

  if (!isNonEmptyString(make, 2) || !isNonEmptyString(model, 1)) {
    return NextResponse.json({ error: "Invalid make/model" }, { status: 400 });
  }
  if (!year || year < 1990 || year > currentYear) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }
  if (!dailyRate || dailyRate <= 0) {
    return NextResponse.json({ error: "Invalid daily rate" }, { status: 400 });
  }
  if (deposit === null || deposit < 0) {
    return NextResponse.json({ error: "Invalid deposit" }, { status: 400 });
  }
  if (!validateStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (seatCount === INVALID_SEAT_COUNT) {
    return NextResponse.json(
      { error: "Invalid seat count. Number of seats must be an integer between 1 and 60." },
      { status: 400 },
    );
  }

  const makeValue = String(make).trim();
  const modelValue = String(model).trim();
  const vehicleName = `${makeValue} ${modelValue}`.trim();
  const features = {
    ...parsedFeatures,
    name: toStringValue(parsedFeatures.name, vehicleName),
    slug: toStringValue(parsedFeatures.slug, slugify(vehicleName)),
    category: toStringValue(parsedFeatures.category, "Vehicle"),
    transmission: toStringValue(parsedFeatures.transmission, "Automatic"),
    seats: seatCount ?? Math.max(1, toNumberValue(parsedFeatures.seats, 5)),
    bags: Math.max(0, toNumberValue(parsedFeatures.bags, 2)),
    description: toStringValue(
      parsedFeatures.description,
      `Reliable ${year} ${vehicleName} rental option for Jamaica travel.`,
    ),
    featured: toBooleanValue(parsedFeatures.featured, false),
    public_visible: toBooleanValue(parsedFeatures.public_visible, true),
  };

  const result = await dbQuery(
    "insert into vehicles (make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, public_id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, created_at",
    [
      makeValue,
      modelValue,
      year,
      seatCount,
      dailyRate,
      deposit,
      status,
      imageUrls,
      features,
    ],
  );

  return NextResponse.json({ vehicle: result.rows[0] }, { status: 201 });
}
