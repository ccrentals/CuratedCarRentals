import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import {
  buildBookingLocationConfigs,
  createCanonicalBookingLocationSeedConfigs,
} from "@/lib/bookings/bookingLocations";
import { toBookingLocationConfigSchemaError } from "@/lib/bookings/bookingLocationConfigStore";
import { dbQuery, getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

type BookingLocationRow = {
  id: string;
  label: string;
  location_type_key: string | null;
  display_label_pickup: string | null;
  display_label_dropoff: string | null;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  applies_to_pickup: boolean;
  applies_to_dropoff: boolean;
  field_schema_json: unknown;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type BookingLocationFieldPayload = {
  key: string;
  label: string;
  input_type: "text" | "date" | "time";
  required: boolean;
  applies_to: "pickup" | "dropoff" | "both";
  default_source: "pickup_date" | "pickup_time" | "dropoff_date" | "dropoff_time" | null;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeTypeKey(value: unknown) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "_");
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSortOrder(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function humanizeTypeKey(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isInputType(value: unknown): value is BookingLocationFieldPayload["input_type"] {
  return value === "text" || value === "date" || value === "time";
}

function isAppliesTo(value: unknown): value is BookingLocationFieldPayload["applies_to"] {
  return value === "pickup" || value === "dropoff" || value === "both";
}

function isDefaultSource(
  value: unknown,
): value is BookingLocationFieldPayload["default_source"] {
  return (
    value === null ||
    value === "pickup_date" ||
    value === "pickup_time" ||
    value === "dropoff_date" ||
    value === "dropoff_time"
  );
}

function normalizeFieldSchema(
  value: unknown,
  fallback: BookingLocationFieldPayload[],
) {
  if (!Array.isArray(value)) return fallback;

  const next = value
    .map((entry) => {
      const record = asRecord(entry);
      const key = normalizeText(record?.key);
      const label = normalizeText(record?.label);
      const inputType = record?.input_type ?? record?.inputType;
      const appliesTo = record?.applies_to ?? record?.appliesTo;
      const defaultSource = record?.default_source ?? record?.defaultSource ?? null;
      const required = normalizeBoolean(record?.required, false);

      if (!key || !label || !isInputType(inputType) || !isAppliesTo(appliesTo)) {
        return null;
      }

      return {
        key,
        label,
        input_type: inputType,
        required,
        applies_to: appliesTo,
        default_source: isDefaultSource(defaultSource) ? defaultSource : null,
      } satisfies BookingLocationFieldPayload;
    })
    .filter((entry): entry is BookingLocationFieldPayload => entry !== null);

  return next.length > 0 ? next : fallback;
}

function serializeLocation(row: BookingLocationRow) {
  const config = buildBookingLocationConfigs([row])[0];
  return {
    id: config.id,
    label: config.label,
    location_type_key: config.locationTypeKey,
    pickup_label: config.pickupLabel,
    dropoff_label: config.dropoffLabel,
    location_type: config.locationType,
    allow_pickup: config.allowPickup,
    allow_dropoff: config.allowDropoff,
    applies_to_pickup: config.appliesToPickup,
    applies_to_dropoff: config.appliesToDropoff,
    is_active: config.isActive,
    sort_order: config.sortOrder,
    db_backed: config.dbBacked,
    field_schema: config.fieldSchema.map((field) => ({
      key: field.key,
      label: field.label,
      input_type: field.inputType,
      required: field.required,
      applies_to: field.appliesTo,
      default_source: field.defaultSource,
    })),
  };
}

const DEFAULT_FIELD_SCHEMA_MAP = new Map(
  createCanonicalBookingLocationSeedConfigs().map((config) => [
    config.locationTypeKey,
    config.fieldSchema.map((field) => ({
      key: field.key,
      label: field.label,
      input_type: field.inputType,
      required: field.required,
      applies_to: field.appliesTo,
      default_source: field.defaultSource,
    })),
  ]),
);

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const result = await dbQuery<BookingLocationRow>(
      `select
         id,
         label,
         location_type_key,
         display_label_pickup,
         display_label_dropoff,
         allow_pickup,
         allow_dropoff,
         applies_to_pickup,
         applies_to_dropoff,
         field_schema_json,
         is_active,
         sort_order,
         created_at,
         updated_at
       from booking_locations
       order by sort_order asc, location_type_key asc, label asc`,
    );

    return NextResponse.json({
      locations: result.rows.map((row: BookingLocationRow) => serializeLocation(row)),
    });
  } catch (error) {
    const schemaError = toBookingLocationConfigSchemaError(error);
    if (schemaError) {
      return NextResponse.json(
        { error: schemaError.message, code: schemaError.code },
        { status: schemaError.status },
      );
    }
    logError("api.admin.booking-locations.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load booking locations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const id = normalizeText(body?.id);
  const locationTypeKey = normalizeTypeKey(
    body?.locationTypeKey ?? body?.location_type_key,
  );
  if (locationTypeKey.length < 2) {
    return NextResponse.json({ error: "Location type key is required." }, { status: 400 });
  }

  const appliesToPickup = normalizeBoolean(
    body?.appliesToPickup ?? body?.allowPickup ?? body?.allow_pickup,
    true,
  );
  const appliesToDropoff = normalizeBoolean(
    body?.appliesToDropoff ?? body?.allowDropoff ?? body?.allow_dropoff,
    true,
  );
  if (!appliesToPickup && !appliesToDropoff) {
    return NextResponse.json(
      { error: "Location type must apply to pickup, dropoff, or both." },
      { status: 400 },
    );
  }

  const pickupLabel = normalizeText(body?.pickupLabel ?? body?.pickup_label);
  const dropoffLabel = normalizeText(body?.dropoffLabel ?? body?.dropoff_label);
  if (appliesToPickup && pickupLabel.length < 2) {
    return NextResponse.json({ error: "Pickup label must be at least 2 characters." }, { status: 400 });
  }
  if (appliesToDropoff && dropoffLabel.length < 2) {
    return NextResponse.json({ error: "Dropoff label must be at least 2 characters." }, { status: 400 });
  }

  const label =
    normalizeText(body?.label) ||
    (pickupLabel && pickupLabel === dropoffLabel
      ? pickupLabel
      : locationTypeKey === "CUSTOM_ADDRESS"
        ? "Custom Address"
        : humanizeTypeKey(locationTypeKey));

  const isActive = normalizeBoolean(body?.isActive ?? body?.is_active, true);
  const sortOrder = normalizeSortOrder(body?.sortOrder ?? body?.sort_order);
  const defaultFieldSchema = DEFAULT_FIELD_SCHEMA_MAP.get(locationTypeKey) ?? [];
  const fieldSchema = normalizeFieldSchema(
    body?.fieldSchema ?? body?.field_schema,
    defaultFieldSchema,
  );

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const existingResult = id
      ? await client.query(
          `select
             id,
             label,
             location_type_key,
             display_label_pickup,
             display_label_dropoff,
             allow_pickup,
             allow_dropoff,
             applies_to_pickup,
             applies_to_dropoff,
             field_schema_json,
             is_active,
             sort_order,
             created_at,
             updated_at
           from booking_locations
           where id = $1
           limit 1
          for update`,
          [id],
        )
      : await client.query(
          `select
             id,
             label,
             location_type_key,
             display_label_pickup,
             display_label_dropoff,
             allow_pickup,
             allow_dropoff,
             applies_to_pickup,
             applies_to_dropoff,
             field_schema_json,
             is_active,
             sort_order,
             created_at,
             updated_at
           from booking_locations
           where location_type_key = $1
           limit 1
          for update`,
          [locationTypeKey],
        );

    const params = [
      label,
      locationTypeKey,
      pickupLabel || label,
      dropoffLabel || label,
      appliesToPickup,
      appliesToDropoff,
      isActive,
      sortOrder,
      JSON.stringify(fieldSchema),
    ];

    let saved: BookingLocationRow;
    if (existingResult.rowCount > 0) {
      const updated = await client.query(
        `update booking_locations
         set
           label = $2,
           location_type_key = $3,
           display_label_pickup = $4,
           display_label_dropoff = $5,
           allow_pickup = $6,
           allow_dropoff = $7,
           applies_to_pickup = $6,
           applies_to_dropoff = $7,
           is_active = $8,
           sort_order = $9,
           field_schema_json = $10::jsonb,
           updated_at = now()
         where id = $1
         returning
           id,
           label,
           location_type_key,
           display_label_pickup,
           display_label_dropoff,
           allow_pickup,
           allow_dropoff,
           applies_to_pickup,
           applies_to_dropoff,
           field_schema_json,
           is_active,
           sort_order,
           created_at,
           updated_at`,
        [(existingResult.rows[0] as BookingLocationRow).id, ...params],
      );
      saved = updated.rows[0] as BookingLocationRow;
    } else {
      const inserted = await client.query(
        `insert into booking_locations (
           label,
           location_type_key,
           display_label_pickup,
           display_label_dropoff,
           allow_pickup,
           allow_dropoff,
           applies_to_pickup,
           applies_to_dropoff,
           is_active,
           sort_order,
           field_schema_json,
           created_by
         )
         values ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8, $9::jsonb, $10)
         returning
           id,
           label,
           location_type_key,
           display_label_pickup,
           display_label_dropoff,
           allow_pickup,
           allow_dropoff,
           applies_to_pickup,
           applies_to_dropoff,
           field_schema_json,
           is_active,
           sort_order,
           created_at,
           updated_at`,
        [...params, actor.userId],
      );
      saved = inserted.rows[0] as BookingLocationRow;
    }

    await client.query("commit");
    return NextResponse.json({ ok: true, location: serializeLocation(saved) });
  } catch (error) {
    await client.query("rollback");
    const schemaError = toBookingLocationConfigSchemaError(error);
    if (schemaError) {
      return NextResponse.json(
        { error: schemaError.message, code: schemaError.code },
        { status: schemaError.status },
      );
    }
    logError("api.admin.booking-locations.POST", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to save booking location." }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const id = normalizeText(body?.id);
  if (!id) {
    return NextResponse.json({ error: "Location id is required." }, { status: 400 });
  }

  try {
    const updated = await dbQuery<{ id: string }>(
      "update booking_locations set is_active = false, updated_at = now() where id = $1 returning id",
      [id],
    );
    if (updated.rowCount === 0) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const schemaError = toBookingLocationConfigSchemaError(error);
    if (schemaError) {
      return NextResponse.json(
        { error: schemaError.message, code: schemaError.code },
        { status: schemaError.status },
      );
    }
    logError("api.admin.booking-locations.DELETE", error, { userId: actor.userId, locationId: id });
    return NextResponse.json({ error: "Failed to deactivate booking location." }, { status: 500 });
  }
}
