import {
  buildBookingLocationConfigs,
  type BookingLocationConfig,
  type BookingLocationDbRow,
} from "@/lib/bookings/bookingLocations";

type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{
    rows: unknown[];
  }>;
};

export const BOOKING_LOCATION_CONFIG_MIGRATION = "044_booking_location_config.sql";

const BOOKING_LOCATION_CONFIG_COLUMNS = [
  "location_type_key",
  "display_label_pickup",
  "display_label_dropoff",
  "applies_to_pickup",
  "applies_to_dropoff",
  "field_schema_json",
  "is_active",
  "sort_order",
] as const;

export class BookingLocationConfigSchemaError extends Error {
  code: string;
  status: number;

  constructor(
    message = getBookingLocationConfigMigrationMessage(),
    code = "BOOKING_LOCATION_CONFIG_MIGRATION_REQUIRED",
    status = 503,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getBookingLocationConfigMigrationMessage() {
  return `Booking location config requires migration ${BOOKING_LOCATION_CONFIG_MIGRATION}. Apply it before using the booking location builder or config-driven booking, quote, and public location flows.`;
}

function hasMissingColumnMessage(message: string) {
  return BOOKING_LOCATION_CONFIG_COLUMNS.some(
    (column) => message.includes(column) && message.includes("does not exist"),
  );
}

export function toBookingLocationConfigSchemaError(error: unknown) {
  if (error instanceof BookingLocationConfigSchemaError) return error;

  const code = String((error as { code?: unknown } | null)?.code ?? "").trim();
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();

  if (code === "42P01" && message.includes("booking_locations")) {
    return new BookingLocationConfigSchemaError();
  }

  if (code === "42703" && hasMissingColumnMessage(message)) {
    return new BookingLocationConfigSchemaError();
  }

  return null;
}

export async function listActiveBookingLocationConfigs(db: Queryable) {
  let result;
  try {
    result = await db.query(
      `select
          id,
          label,
          allow_pickup,
          allow_dropoff,
          applies_to_pickup,
          applies_to_dropoff,
          location_type_key,
          display_label_pickup,
          display_label_dropoff,
          field_schema_json,
          is_active,
          sort_order
        from booking_locations
        where is_active = true
        order by sort_order asc, location_type_key asc, created_at asc`,
    );
  } catch (error) {
    throw toBookingLocationConfigSchemaError(error) ?? error;
  }

  return buildBookingLocationConfigs(result.rows as BookingLocationDbRow[]).filter(
    (config) => config.isActive,
  );
}

export function findBookingLocationConfigById(
  configs: BookingLocationConfig[],
  id: string | null | undefined,
) {
  if (!id) return null;
  return configs.find((config) => config.id === id) ?? null;
}
