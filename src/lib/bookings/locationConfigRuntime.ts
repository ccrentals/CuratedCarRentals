import {
  createBookingLocationDetails,
  getBookingLocationDisplayLabel,
  type BookingLocationConfig,
  type BookingLocationDetails,
  type BookingLocationFieldSchema,
  type BookingLocationFieldValueMap,
  type BookingLocationSide,
} from "@/lib/bookings/bookingLocations";

export type BookingLocationDefaultContext = {
  pickupDate: string;
  pickupTime: string;
  dropoffDate: string;
  dropoffTime: string;
};

function normalizeLocationFieldValue(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeBookingLocationFieldValuesInput(
  value: unknown,
  fallbackValues: BookingLocationFieldValueMap = {},
) {
  const next: BookingLocationFieldValueMap = {};

  for (const [key, entry] of Object.entries(fallbackValues)) {
    next[key] = normalizeLocationFieldValue(entry);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    next[key] = normalizeLocationFieldValue(entry);
  }

  return next;
}

export function getBookingLocationConfigsForSide(
  configs: BookingLocationConfig[],
  side: BookingLocationSide,
) {
  return configs.filter((config) =>
    side === "pickup" ? config.appliesToPickup : config.appliesToDropoff,
  );
}

export function getBookingLocationConfigByType(
  configs: BookingLocationConfig[],
  typeKey: string,
  side: BookingLocationSide,
) {
  const normalized = typeKey.trim().toUpperCase();
  const sideConfigs = getBookingLocationConfigsForSide(configs, side);
  return (
    sideConfigs.find((config) => config.locationTypeKey === normalized) ??
    sideConfigs[0] ??
    null
  );
}

export function getBookingLocationFieldSchemaForSide(
  config: BookingLocationConfig | null,
  side: BookingLocationSide,
) {
  if (!config) return [] as BookingLocationFieldSchema[];
  return config.fieldSchema.filter(
    (field) => field.appliesTo === side || field.appliesTo === "both",
  );
}

function resolveDefaultValue(
  field: BookingLocationFieldSchema,
  context: BookingLocationDefaultContext,
) {
  if (field.defaultSource === "pickup_date") return context.pickupDate;
  if (field.defaultSource === "pickup_time") return context.pickupTime;
  if (field.defaultSource === "dropoff_date") return context.dropoffDate;
  if (field.defaultSource === "dropoff_time") return context.dropoffTime;
  return null;
}

export function buildBookingLocationDefaultValues(
  config: BookingLocationConfig | null,
  side: BookingLocationSide,
  context: BookingLocationDefaultContext,
) {
  return getBookingLocationFieldSchemaForSide(config, side).reduce<BookingLocationFieldValueMap>(
    (accumulator, field) => {
      accumulator[field.key] = resolveDefaultValue(field, context);
      return accumulator;
    },
    {},
  );
}

export function coerceBookingLocationFieldValues(
  config: BookingLocationConfig | null,
  side: BookingLocationSide,
  currentValues: BookingLocationFieldValueMap,
  context: BookingLocationDefaultContext,
) {
  const defaults = buildBookingLocationDefaultValues(config, side, context);
  const next: BookingLocationFieldValueMap = {};

  for (const field of getBookingLocationFieldSchemaForSide(config, side)) {
    const currentValue = currentValues[field.key];
    next[field.key] =
      typeof currentValue === "string" && currentValue.trim().length > 0
        ? currentValue.trim()
        : defaults[field.key] ?? null;
  }

  return next;
}

export function getBookingLocationSnapshotText(
  config: BookingLocationConfig | null,
  side: BookingLocationSide,
  values: BookingLocationFieldValueMap,
) {
  const address = typeof values.address === "string" ? values.address.trim() : "";
  if (address) return address;
  if (!config) return "";
  return side === "pickup" ? config.pickupLabel : config.dropoffLabel;
}

export function validateBookingLocationSelection(
  config: BookingLocationConfig | null,
  side: BookingLocationSide,
  values: BookingLocationFieldValueMap,
) {
  for (const field of getBookingLocationFieldSchemaForSide(config, side)) {
    if (!field.required) continue;
    const value = typeof values[field.key] === "string" ? values[field.key]?.trim() ?? "" : "";
    if (!value) {
      return `${field.label} is required`;
    }
  }
  return null;
}

export function buildBookingLocationSelectionPayload(input: {
  configs: BookingLocationConfig[];
  pickupTypeKey: string;
  dropoffTypeKey: string;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
  pickupValues: BookingLocationFieldValueMap;
  dropoffValues: BookingLocationFieldValueMap;
  context: BookingLocationDefaultContext;
}) {
  const pickupConfig = getBookingLocationConfigByType(input.configs, input.pickupTypeKey, "pickup");
  const dropoffConfig = getBookingLocationConfigByType(
    input.configs,
    input.dropoffTypeKey,
    "dropoff",
  );
  const pickupResolvedValues = coerceBookingLocationFieldValues(
    pickupConfig,
    "pickup",
    input.pickupValues,
    input.context,
  );
  const dropoffResolvedValues = coerceBookingLocationFieldValues(
    dropoffConfig,
    "dropoff",
    input.dropoffValues,
    input.context,
  );
  const pickupLocationTextSnapshot = getBookingLocationSnapshotText(
    pickupConfig,
    "pickup",
    pickupResolvedValues,
  );
  const dropoffLocationTextSnapshot = getBookingLocationSnapshotText(
    dropoffConfig,
    "dropoff",
    dropoffResolvedValues,
  );

  const details: BookingLocationDetails = createBookingLocationDetails({
    pickup: {
      typeKey: pickupConfig?.locationTypeKey ?? input.pickupTypeKey,
      label:
        pickupConfig?.pickupLabel ??
        getBookingLocationDisplayLabel(input.pickupTypeKey, "pickup"),
      locationId: input.pickupLocationId ?? pickupConfig?.id ?? null,
      values: pickupResolvedValues,
    },
    dropoff: {
      typeKey: dropoffConfig?.locationTypeKey ?? input.dropoffTypeKey,
      label:
        dropoffConfig?.dropoffLabel ??
        getBookingLocationDisplayLabel(input.dropoffTypeKey, "dropoff"),
      locationId: input.dropoffLocationId ?? dropoffConfig?.id ?? null,
      values: dropoffResolvedValues,
    },
  });

  return {
    pickupConfig,
    dropoffConfig,
    pickupValues: pickupResolvedValues,
    dropoffValues: dropoffResolvedValues,
    pickupLocationTextSnapshot,
    dropoffLocationTextSnapshot,
    details,
  };
}
