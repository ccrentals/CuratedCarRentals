export const BOOKING_LOCATION_LABELS = {
  OFFICE: "168 1/2 Old Hope Road, Kingston Jamaica",
  AIRPORT: "Norman Manley Airport",
  PICKUP_CUSTOM: "Pick up Address",
  DROPOFF_CUSTOM: "Return Address",
  CUSTOM_NEUTRAL: "Custom Address",
} as const;

export const LEGACY_BOOKING_LOCATION_LABELS = {
  AIRPORT: "Kingston International Airport",
} as const;

export const BOOKING_LOCATION_TYPES = ["OFFICE", "AIRPORT", "CUSTOM_ADDRESS"] as const;
export const BOOKING_LOCATION_FIELD_INPUT_TYPES = ["text", "date", "time"] as const;
export const BOOKING_LOCATION_FIELD_APPLIES_TO = ["pickup", "dropoff", "both"] as const;
export const BOOKING_LOCATION_FIELD_DEFAULT_SOURCES = [
  "pickup_date",
  "pickup_time",
  "dropoff_date",
  "dropoff_time",
] as const;

export type BookingLocationType = string;
export type BookingLocationSide = "pickup" | "dropoff";
export type BookingLocationFieldInputType =
  (typeof BOOKING_LOCATION_FIELD_INPUT_TYPES)[number];
export type BookingLocationFieldAppliesTo =
  (typeof BOOKING_LOCATION_FIELD_APPLIES_TO)[number];
export type BookingLocationFieldDefaultSource =
  | (typeof BOOKING_LOCATION_FIELD_DEFAULT_SOURCES)[number]
  | null;

export type BookingLocationFieldSchema = {
  key: string;
  label: string;
  inputType: BookingLocationFieldInputType;
  required: boolean;
  appliesTo: BookingLocationFieldAppliesTo;
  defaultSource: BookingLocationFieldDefaultSource;
};

export type BookingLocationDbRow = {
  id: string;
  label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  applies_to_pickup?: boolean;
  applies_to_dropoff?: boolean;
  location_type_key?: string | null;
  display_label_pickup?: string | null;
  display_label_dropoff?: string | null;
  field_schema_json?: unknown;
  is_active: boolean;
  sort_order: number;
};

export type BookingLocationConfig = {
  id: string | null;
  locationType: BookingLocationType;
  locationTypeKey: BookingLocationType;
  label: string;
  pickupLabel: string;
  dropoffLabel: string;
  allowPickup: boolean;
  allowDropoff: boolean;
  appliesToPickup: boolean;
  appliesToDropoff: boolean;
  isActive: boolean;
  sortOrder: number;
  fieldSchema: BookingLocationFieldSchema[];
  dbBacked: boolean;
};

export type BookingLocationFieldValueMap = Record<string, string | null>;
export type BookingLocationFieldLabelMap = Record<string, string>;

export type BookingLocationDetailsEntry = {
  type: BookingLocationType;
  typeKey: BookingLocationType;
  label: string;
  locationId: string | null;
  values: BookingLocationFieldValueMap;
  fieldLabels: BookingLocationFieldLabelMap;
  address: string | null;
  flightDate: string | null;
  flightTime: string | null;
  flightNumber: string | null;
  airline: string | null;
};

export type BookingLocationDetails = {
  pickup: BookingLocationDetailsEntry;
  dropoff: BookingLocationDetailsEntry;
};

type BookingLocationDetailsInputEntry = {
  type?: unknown;
  typeKey?: unknown;
  label?: unknown;
  address?: unknown;
  flightDate?: unknown;
  flightTime?: unknown;
  flightNumber?: unknown;
  airline?: unknown;
  locationId?: unknown;
  values?: unknown;
  fieldLabels?: unknown;
};

type BookingLocationDetailsInput = {
  pickup: BookingLocationDetailsInputEntry;
  dropoff: BookingLocationDetailsInputEntry;
};

type BookingLocationDetailsFallback = {
  pickupLabel?: string | null;
  dropoffLabel?: string | null;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
};

type AdminNoteEntry = {
  note_id?: string;
  message?: string;
  created_at?: string;
  user_id?: string | null;
  system_generated?: boolean;
  system_type?: string;
};

type CanonicalBookingLocationSeed = {
  locationTypeKey: BookingLocationType;
  label: string;
  pickupLabel: string;
  dropoffLabel: string;
  appliesToPickup: boolean;
  appliesToDropoff: boolean;
  sortOrder: number;
  fieldSchema: BookingLocationFieldSchema[];
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function labelMatches(candidate: string, expected: string) {
  return candidate.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0;
}

function isFieldInputType(value: unknown): value is BookingLocationFieldInputType {
  return (
    value === "text" ||
    value === "date" ||
    value === "time"
  );
}

function isFieldAppliesTo(value: unknown): value is BookingLocationFieldAppliesTo {
  return value === "pickup" || value === "dropoff" || value === "both";
}

function isFieldDefaultSource(value: unknown): value is BookingLocationFieldDefaultSource {
  return (
    value === null ||
    value === "pickup_date" ||
    value === "pickup_time" ||
    value === "dropoff_date" ||
    value === "dropoff_time"
  );
}

function humanizeSnakeCase(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeLocationTypeKey(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.toUpperCase().replace(/\s+/g, "_");
}

export function inferBookingLocationType(input: {
  locationType?: unknown;
  typeKey?: unknown;
  label?: unknown;
}): BookingLocationType | null {
  const fromKey =
    normalizeLocationTypeKey(input.typeKey) || normalizeLocationTypeKey(input.locationType);
  if (fromKey) return fromKey;

  const label = normalizeText(input.label);
  if (!label) return null;
  if (labelMatches(label, BOOKING_LOCATION_LABELS.OFFICE)) return "OFFICE";
  if (
    labelMatches(label, BOOKING_LOCATION_LABELS.AIRPORT) ||
    labelMatches(label, LEGACY_BOOKING_LOCATION_LABELS.AIRPORT)
  ) {
    return "AIRPORT";
  }
  if (
    labelMatches(label, BOOKING_LOCATION_LABELS.PICKUP_CUSTOM) ||
    labelMatches(label, BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM) ||
    labelMatches(label, BOOKING_LOCATION_LABELS.CUSTOM_NEUTRAL)
  ) {
    return "CUSTOM_ADDRESS";
  }
  return "CUSTOM_ADDRESS";
}

export function getBookingLocationDisplayLabel(
  type: BookingLocationType,
  side: BookingLocationSide,
) {
  const normalizedType = normalizeLocationTypeKey(type);
  if (normalizedType === "OFFICE") return BOOKING_LOCATION_LABELS.OFFICE;
  if (normalizedType === "AIRPORT") return BOOKING_LOCATION_LABELS.AIRPORT;
  if (normalizedType === "CUSTOM_ADDRESS") {
    return side === "pickup"
      ? BOOKING_LOCATION_LABELS.PICKUP_CUSTOM
      : BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM;
  }
  return humanizeSnakeCase(type);
}

export function getBookingLocationAdminBadgeLabel(type: BookingLocationType) {
  const normalizedType = normalizeLocationTypeKey(type);
  if (normalizedType === "OFFICE") return "Old Hope Road";
  if (normalizedType === "AIRPORT") return "Airport";
  if (normalizedType === "CUSTOM_ADDRESS") return "Custom address";
  return humanizeSnakeCase(type);
}

function buildDefaultFieldSchemaForType(type: BookingLocationType): BookingLocationFieldSchema[] {
  const normalizedType = normalizeLocationTypeKey(type);
  if (normalizedType === "AIRPORT") {
    return [
      {
        key: "flight_date",
        label: "Flight Arrival Date",
        inputType: "date",
        required: false,
        appliesTo: "pickup",
        defaultSource: "pickup_date",
      },
      {
        key: "flight_time",
        label: "Flight Arrival Time",
        inputType: "time",
        required: false,
        appliesTo: "pickup",
        defaultSource: "pickup_time",
      },
      {
        key: "flight_number",
        label: "Flight Number",
        inputType: "text",
        required: false,
        appliesTo: "pickup",
        defaultSource: null,
      },
      {
        key: "airline",
        label: "Airline",
        inputType: "text",
        required: false,
        appliesTo: "pickup",
        defaultSource: null,
      },
      {
        key: "flight_date",
        label: "Flight Departure Date",
        inputType: "date",
        required: false,
        appliesTo: "dropoff",
        defaultSource: "dropoff_date",
      },
      {
        key: "flight_time",
        label: "Flight Departure Time",
        inputType: "time",
        required: false,
        appliesTo: "dropoff",
        defaultSource: "dropoff_time",
      },
      {
        key: "flight_number",
        label: "Flight Number",
        inputType: "text",
        required: false,
        appliesTo: "dropoff",
        defaultSource: null,
      },
      {
        key: "airline",
        label: "Airline",
        inputType: "text",
        required: false,
        appliesTo: "dropoff",
        defaultSource: null,
      },
    ];
  }

  if (normalizedType === "CUSTOM_ADDRESS") {
    return [
      {
        key: "address",
        label: BOOKING_LOCATION_LABELS.PICKUP_CUSTOM,
        inputType: "text",
        required: true,
        appliesTo: "pickup",
        defaultSource: null,
      },
      {
        key: "address",
        label: BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM,
        inputType: "text",
        required: true,
        appliesTo: "dropoff",
        defaultSource: null,
      },
    ];
  }

  return [];
}

function normalizeFieldSchemaEntry(value: unknown): BookingLocationFieldSchema | null {
  const record = asRecord(value);
  const key = normalizeText(record?.key);
  const label = normalizeText(record?.label);
  const inputType = record?.input_type ?? record?.inputType;
  const appliesTo = record?.applies_to ?? record?.appliesTo;
  const defaultSource = record?.default_source ?? record?.defaultSource ?? null;
  const required = normalizeBoolean(record?.required, false);

  if (!key || !label || !isFieldInputType(inputType) || !isFieldAppliesTo(appliesTo)) {
    return null;
  }

  return {
    key,
    label,
    inputType,
    required,
    appliesTo,
    defaultSource: isFieldDefaultSource(defaultSource) ? defaultSource : null,
  };
}

function normalizeFieldSchemaJson(
  value: unknown,
  type: BookingLocationType,
): BookingLocationFieldSchema[] {
  if (!Array.isArray(value)) {
    return buildDefaultFieldSchemaForType(type);
  }

  const normalized = value
    .map((entry) => normalizeFieldSchemaEntry(entry))
    .filter((entry): entry is BookingLocationFieldSchema => entry !== null);

  return normalized.length > 0 ? normalized : buildDefaultFieldSchemaForType(type);
}

function createSeedConfig(seed: CanonicalBookingLocationSeed): BookingLocationConfig {
  return {
    id: null,
    locationType: seed.locationTypeKey,
    locationTypeKey: seed.locationTypeKey,
    label: seed.label,
    pickupLabel: seed.pickupLabel,
    dropoffLabel: seed.dropoffLabel,
    allowPickup: seed.appliesToPickup,
    allowDropoff: seed.appliesToDropoff,
    appliesToPickup: seed.appliesToPickup,
    appliesToDropoff: seed.appliesToDropoff,
    isActive: true,
    sortOrder: seed.sortOrder,
    fieldSchema: seed.fieldSchema,
    dbBacked: false,
  };
}

export function createCanonicalBookingLocationSeedConfigs(): BookingLocationConfig[] {
  return [
    createSeedConfig({
      locationTypeKey: "OFFICE",
      label: BOOKING_LOCATION_LABELS.OFFICE,
      pickupLabel: BOOKING_LOCATION_LABELS.OFFICE,
      dropoffLabel: BOOKING_LOCATION_LABELS.OFFICE,
      appliesToPickup: true,
      appliesToDropoff: true,
      sortOrder: 1,
      fieldSchema: [],
    }),
    createSeedConfig({
      locationTypeKey: "AIRPORT",
      label: BOOKING_LOCATION_LABELS.AIRPORT,
      pickupLabel: BOOKING_LOCATION_LABELS.AIRPORT,
      dropoffLabel: BOOKING_LOCATION_LABELS.AIRPORT,
      appliesToPickup: true,
      appliesToDropoff: true,
      sortOrder: 2,
      fieldSchema: buildDefaultFieldSchemaForType("AIRPORT"),
    }),
    createSeedConfig({
      locationTypeKey: "CUSTOM_ADDRESS",
      label: BOOKING_LOCATION_LABELS.CUSTOM_NEUTRAL,
      pickupLabel: BOOKING_LOCATION_LABELS.PICKUP_CUSTOM,
      dropoffLabel: BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM,
      appliesToPickup: true,
      appliesToDropoff: true,
      sortOrder: 3,
      fieldSchema: buildDefaultFieldSchemaForType("CUSTOM_ADDRESS"),
    }),
  ];
}

function isConfigBackedRow(row: BookingLocationDbRow) {
  return (
    typeof row.location_type_key === "string" ||
    typeof row.display_label_pickup === "string" ||
    typeof row.display_label_dropoff === "string" ||
    row.field_schema_json !== undefined
  );
}

function normalizeRowToConfig(row: BookingLocationDbRow): BookingLocationConfig {
  const inferredType =
    inferBookingLocationType({
      typeKey: row.location_type_key,
      label: row.label,
    }) ?? "CUSTOM_ADDRESS";

  const label =
    normalizeOptionalText(row.label) ??
    (inferredType === "CUSTOM_ADDRESS"
      ? BOOKING_LOCATION_LABELS.CUSTOM_NEUTRAL
      : getBookingLocationDisplayLabel(inferredType, "pickup"));
  const allowPickup = normalizeBoolean(
    row.applies_to_pickup,
    normalizeBoolean(row.allow_pickup, true),
  );
  const allowDropoff = normalizeBoolean(
    row.applies_to_dropoff,
    normalizeBoolean(row.allow_dropoff, true),
  );

  return {
    id: normalizeOptionalText(row.id),
    locationType: inferredType,
    locationTypeKey: inferredType,
    label,
    pickupLabel:
      normalizeOptionalText(row.display_label_pickup) ??
      (inferredType === "CUSTOM_ADDRESS"
        ? BOOKING_LOCATION_LABELS.PICKUP_CUSTOM
        : label),
    dropoffLabel:
      normalizeOptionalText(row.display_label_dropoff) ??
      (inferredType === "CUSTOM_ADDRESS"
        ? BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM
        : label),
    allowPickup,
    allowDropoff,
    appliesToPickup: allowPickup,
    appliesToDropoff: allowDropoff,
    isActive: normalizeBoolean(row.is_active, true),
    sortOrder: normalizeInteger(row.sort_order, 0),
    fieldSchema: normalizeFieldSchemaJson(row.field_schema_json, inferredType),
    dbBacked: true,
  };
}

export function buildBookingLocationConfigs(rows: BookingLocationDbRow[] = []) {
  if (rows.length === 0) {
    return createCanonicalBookingLocationSeedConfigs();
  }

  if (rows.some((row) => isConfigBackedRow(row))) {
    return rows
      .map((row) => normalizeRowToConfig(row))
      .sort((a, b) =>
        a.sortOrder === b.sortOrder
          ? a.locationTypeKey.localeCompare(b.locationTypeKey)
          : a.sortOrder - b.sortOrder,
      );
  }

  const canonical = createCanonicalBookingLocationSeedConfigs();
  const officeRow =
    rows.find((row) => inferBookingLocationType({ label: row.label }) === "OFFICE") ?? null;
  const airportRow =
    rows.find((row) => inferBookingLocationType({ label: row.label }) === "AIRPORT") ?? null;

  return canonical.map((config) => {
    const backingRow =
      config.locationTypeKey === "OFFICE"
        ? officeRow
        : config.locationTypeKey === "AIRPORT"
          ? airportRow
          : null;
    return {
      ...config,
      id: normalizeOptionalText(backingRow?.id),
      dbBacked: Boolean(backingRow),
    };
  });
}

export function buildBookingLocationConfigMap(configs: BookingLocationConfig[]) {
  return new Map(configs.map((config) => [normalizeLocationTypeKey(config.locationTypeKey), config] as const));
}

function normalizeFieldValueMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as BookingLocationFieldValueMap;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, fieldValue]) => [key, normalizeOptionalText(fieldValue)] as const,
  );
  return Object.fromEntries(entries) as BookingLocationFieldValueMap;
}

function normalizeFieldLabelMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as BookingLocationFieldLabelMap;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, fieldLabel]) => [key, normalizeOptionalText(fieldLabel)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  return Object.fromEntries(entries) as BookingLocationFieldLabelMap;
}

function buildDefaultFieldLabelsForEntry(
  side: BookingLocationSide,
  typeKey: BookingLocationType,
  values: BookingLocationFieldValueMap,
) {
  const defaults = buildDefaultFieldSchemaForType(typeKey)
    .filter((field) => field.appliesTo === side || field.appliesTo === "both")
    .reduce<BookingLocationFieldLabelMap>((accumulator, field) => {
      accumulator[field.key] = field.label;
      return accumulator;
    }, {});

  if (values.address && !defaults.address) {
    defaults.address = side === "pickup"
      ? BOOKING_LOCATION_LABELS.PICKUP_CUSTOM
      : BOOKING_LOCATION_LABELS.DROPOFF_CUSTOM;
  }
  if (values.flight_date && !defaults.flight_date) {
    defaults.flight_date = side === "pickup" ? "Flight Arrival Date" : "Flight Departure Date";
  }
  if (values.flight_time && !defaults.flight_time) {
    defaults.flight_time = side === "pickup" ? "Flight Arrival Time" : "Flight Departure Time";
  }
  if (values.flight_number && !defaults.flight_number) {
    defaults.flight_number = "Flight Number";
  }
  if (values.airline && !defaults.airline) {
    defaults.airline = "Airline";
  }

  return defaults;
}

function createDetailsEntry(
  side: BookingLocationSide,
  entry: BookingLocationDetailsInputEntry,
): BookingLocationDetailsEntry {
  const typeKey =
    inferBookingLocationType({
      typeKey: entry.typeKey,
      locationType: entry.type,
      label: entry.label,
    }) ?? "CUSTOM_ADDRESS";
  const values = normalizeFieldValueMap(entry.values);

  if (entry.address !== undefined) {
    values.address = normalizeOptionalText(entry.address);
  }
  if (entry.flightDate !== undefined) {
    values.flight_date = normalizeOptionalText(entry.flightDate);
  }
  if (entry.flightTime !== undefined) {
    values.flight_time = normalizeOptionalText(entry.flightTime);
  }
  if (entry.flightNumber !== undefined) {
    values.flight_number = normalizeOptionalText(entry.flightNumber);
  }
  if (entry.airline !== undefined) {
    values.airline = normalizeOptionalText(entry.airline);
  }

  const fieldLabels = {
    ...buildDefaultFieldLabelsForEntry(side, typeKey, values),
    ...normalizeFieldLabelMap(entry.fieldLabels),
  };

  return {
    type: typeKey,
    typeKey,
    label:
      normalizeOptionalText(entry.label) ?? getBookingLocationDisplayLabel(typeKey, side),
    locationId: normalizeOptionalText(entry.locationId),
    values,
    fieldLabels,
    address: values.address ?? null,
    flightDate: values.flight_date ?? null,
    flightTime: values.flight_time ?? null,
    flightNumber: values.flight_number ?? null,
    airline: values.airline ?? null,
  };
}

export function createBookingLocationDetails(input: BookingLocationDetailsInput): BookingLocationDetails {
  return {
    pickup: createDetailsEntry("pickup", input.pickup),
    dropoff: createDetailsEntry("dropoff", input.dropoff),
  };
}

function formatSideSummary(sideLabel: string, entry: BookingLocationDetailsEntry) {
  const parts = [`${sideLabel}: ${entry.label}`];
  for (const [key, value] of Object.entries(entry.values)) {
    if (!value) continue;
    const fieldLabel = entry.fieldLabels[key] ?? humanizeSnakeCase(key);
    parts.push(`${fieldLabel} ${value}`);
  }
  return parts.join(" • ");
}

export function formatBookingLocationAdminNote(details: BookingLocationDetails) {
  return [
    "Booking location details",
    formatSideSummary("Pickup", details.pickup),
    formatSideSummary("Dropoff", details.dropoff),
  ].join(" | ");
}

export function getBookingLocationDetailLines(entry: BookingLocationDetailsEntry) {
  return Object.entries(entry.values)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => {
      const fieldLabel = entry.fieldLabels[key] ?? humanizeSnakeCase(key);
      return `${fieldLabel}: ${value}`;
    });
}

export function formatBookingLocationDisplayText(
  entry: BookingLocationDetailsEntry,
  options: {
    includeLabel?: boolean;
    separator?: string;
  } = {},
) {
  const separator = options.separator ?? " | ";
  const parts = options.includeLabel === false ? [] : [entry.label];
  parts.push(...getBookingLocationDetailLines(entry));
  return parts.join(separator);
}

export function appendBookingLocationNote(
  pricing: Record<string, unknown> | null | undefined,
  details: BookingLocationDetails,
  createdAt = new Date().toISOString(),
) {
  const basePricing = pricing && typeof pricing === "object" ? { ...pricing } : {};
  const existingNotesRaw = Array.isArray((basePricing as { admin_notes?: unknown }).admin_notes)
    ? ((basePricing as { admin_notes: unknown[] }).admin_notes as unknown[])
    : [];

  const nextNote: AdminNoteEntry = {
    note_id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : undefined,
    message: formatBookingLocationAdminNote(details),
    created_at: createdAt,
    user_id: null,
    system_generated: true,
    system_type: "BOOKING_LOCATION_DETAILS",
  };

  return {
    ...basePricing,
    booking_location_details: details,
    admin_notes: [...existingNotesRaw, nextNote],
  };
}

function readDetailsEntry(
  side: BookingLocationSide,
  value: unknown,
  fallbackLabel: string | null,
  fallbackLocationId: string | null,
): BookingLocationDetailsEntry {
  const record = asRecord(value);
  return createDetailsEntry(side, {
    typeKey: record?.typeKey ?? record?.type,
    label: record?.label ?? fallbackLabel,
    locationId: record?.locationId ?? fallbackLocationId,
    values: record?.values,
    fieldLabels: record?.fieldLabels,
    address: record?.address,
    flightDate: record?.flightDate,
    flightTime: record?.flightTime,
    flightNumber: record?.flightNumber,
    airline: record?.airline,
  });
}

export function readBookingLocationDetails(
  pricing: Record<string, unknown> | null | undefined,
  fallback: BookingLocationDetailsFallback,
): BookingLocationDetails {
  const record = asRecord(pricing?.booking_location_details);
  return {
    pickup: readDetailsEntry(
      "pickup",
      record?.pickup,
      normalizeOptionalText(fallback.pickupLabel),
      normalizeOptionalText(fallback.pickupLocationId),
    ),
    dropoff: readDetailsEntry(
      "dropoff",
      record?.dropoff,
      normalizeOptionalText(fallback.dropoffLabel),
      normalizeOptionalText(fallback.dropoffLocationId),
    ),
  };
}
