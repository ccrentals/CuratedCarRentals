import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { buildBookingLocationConfigs } from "@/lib/bookings/bookingLocations";
import { toBookingLocationConfigSchemaError } from "@/lib/bookings/bookingLocationConfigStore";
import { logError } from "@/lib/log";

type BookingLocationRow = {
  id: string;
  label: string;
  location_type_key?: string | null;
  display_label_pickup?: string | null;
  display_label_dropoff?: string | null;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  applies_to_pickup?: boolean;
  applies_to_dropoff?: boolean;
  field_schema_json?: unknown;
  is_active: boolean;
  sort_order: number;
};

type PublicLocationsGetDeps = {
  listLocations: () => Promise<BookingLocationRow[]>;
};

const DEFAULT_GET_DEPS: PublicLocationsGetDeps = {
  listLocations: async () => {
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
         sort_order
       from booking_locations
       where is_active = true
       order by sort_order asc, location_type_key asc, label asc`,
    );
    return result.rows;
  },
};

export async function handlePublicLocationsGet(
  deps: PublicLocationsGetDeps = DEFAULT_GET_DEPS,
) {
  try {
    const locations = buildBookingLocationConfigs(await deps.listLocations()).map((location) => ({
      id: location.id,
      label: location.label,
      location_type_key: location.locationTypeKey,
      pickup_label: location.pickupLabel,
      dropoff_label: location.dropoffLabel,
      location_type: location.locationType,
      allow_pickup: location.allowPickup,
      allow_dropoff: location.allowDropoff,
      applies_to_pickup: location.appliesToPickup,
      applies_to_dropoff: location.appliesToDropoff,
      is_active: location.isActive,
      sort_order: location.sortOrder,
      field_schema: location.fieldSchema.map((field) => ({
        key: field.key,
        label: field.label,
        input_type: field.inputType,
        required: field.required,
        applies_to: field.appliesTo,
        default_source: field.defaultSource,
      })),
    }));
    return NextResponse.json({ locations });
  } catch (error) {
    const schemaError = toBookingLocationConfigSchemaError(error);
    if (schemaError) {
      return NextResponse.json(
        { error: schemaError.message, code: schemaError.code },
        { status: schemaError.status },
      );
    }
    logError("api.public.locations.GET", error);
    return NextResponse.json({ error: "Failed to load locations." }, { status: 500 });
  }
}

export async function GET() {
  return handlePublicLocationsGet();
}
