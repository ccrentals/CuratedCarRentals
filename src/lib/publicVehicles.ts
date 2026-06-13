import { dbQuery } from "@/lib/db";
import type { Vehicle } from "@/data/vehicles";
import {
  loadAdminSettings,
  resolveVehicleSecurityDepositJmd,
  type AdminSettings,
} from "@/lib/adminSettings";
import {
  isVehicleUnavailableWithAvailabilityRules,
  listAvailableVehiclesWithAvailabilityRules,
} from "@/lib/bookings/availabilityRules";
import { bookingDateTimeToUtcIso } from "@/lib/bookings/bookingDateTime";

export type PublicVehicle = Vehicle & {
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  security_deposit_jmd: number | null;
  status: string;
  slug: string;
  legacyId: string | null;
  doors: number;
  fuelPolicy: string;
  mileagePolicy: string;
  airConditioning: boolean;
  hybrid: boolean;
  drivetrain: string;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  seat_count: number | null;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  created_at: string;
  features_json: unknown;
  image_urls_json: unknown;
};

export type AvailabilityWindowInput = {
  pickupDate: string;
  dropoffDate: string;
  pickupTime?: string | null;
  dropoffTime?: string | null;
};

type NormalizedAvailabilityWindow = {
  pickupDate: string;
  dropoffDate: string;
  pickupTime: string;
  dropoffTime: string;
  startAtIso: string;
  endAtIso: string;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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

function pickMetaValue(meta: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (meta[key] !== undefined && meta[key] !== null) return meta[key];
  }
  return undefined;
}

function readMetaText(meta: Record<string, unknown>, keys: string[], fallback = "") {
  return toStringValue(pickMetaValue(meta, keys), fallback);
}

function readMetaNumber(meta: Record<string, unknown>, keys: string[], fallback: number) {
  return toNumberValue(pickMetaValue(meta, keys), fallback);
}

function readMetaBoolean(meta: Record<string, unknown>, keys: string[], fallback = false) {
  return toBooleanValue(pickMetaValue(meta, keys), fallback);
}

function toImageArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      if (item.startsWith("/")) return true;

      try {
        const parsed = new URL(item);
        if (!["http:", "https:"].includes(parsed.protocol)) return false;

        const hostname = parsed.hostname.trim().toLowerCase();
        if (!hostname || hostname === "base") return false;
        if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname)) {
          return process.env.NODE_ENV !== "production";
        }

        return hostname.includes(".");
      } catch {
        return false;
      }
    });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeDateOnly(value: string) {
  return DATE_ONLY_REGEX.test(value) ? value : null;
}

function normalizeTimeOnly(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return TIME_ONLY_REGEX.test(normalized) ? normalized : fallback;
}

function toNormalizedAvailabilityWindow(
  input: AvailabilityWindowInput,
): NormalizedAvailabilityWindow | null {
  const pickupDate = normalizeDateOnly(input.pickupDate);
  const dropoffDate = normalizeDateOnly(input.dropoffDate);
  if (!pickupDate || !dropoffDate) return null;

  const pickupTime = normalizeTimeOnly(input.pickupTime, "00:00");
  const dropoffTime = normalizeTimeOnly(input.dropoffTime, "23:59");
  const startAtIso = bookingDateTimeToUtcIso(pickupDate, pickupTime);
  const endAtIso = bookingDateTimeToUtcIso(dropoffDate, dropoffTime);
  if (!startAtIso || !endAtIso || endAtIso <= startAtIso) return null;

  return {
    pickupDate,
    dropoffDate,
    pickupTime,
    dropoffTime,
    startAtIso,
    endAtIso,
  };
}

function mapRowToPublicVehicle(
  row: VehicleRow,
  settings: Pick<AdminSettings, "bookingVehicleSecurityDeposits">,
): PublicVehicle | null {
  if (!Number.isFinite(row.daily_rate_cents) || row.daily_rate_cents <= 0) {
    return null;
  }

  const meta = toObject(row.features_json);
  const name = toStringValue(meta.name, `${row.make} ${row.model}`.trim());
  const category = toStringValue(meta.category, "Vehicle");
  const transmissionRaw = toStringValue(meta.transmission, "Automatic");
  const transmission: "Automatic" | "Manual" =
    transmissionRaw.toLowerCase() === "manual" ? "Manual" : "Automatic";
  const seats = row.seat_count && row.seat_count >= 1 ? row.seat_count : Math.max(1, toNumberValue(meta.seats, 5));
  const bags = Math.max(0, toNumberValue(meta.bags, 2));
  const doors = Math.max(2, readMetaNumber(meta, ["doors", "door_count", "doorCount"], 4));
  const fuelPolicy = readMetaText(meta, ["fuel_policy", "fuelPolicy"], "Fuel: Full to Full");
  const mileagePolicy = readMetaText(meta, ["mileage_policy", "mileagePolicy"], "Unl. Miles");
  const airConditioning = readMetaBoolean(
    meta,
    ["air_conditioning", "airConditioning", "ac", "a_c"],
    true,
  );
  const drivetrain = readMetaText(meta, ["drivetrain", "drive"], "");
  const hybrid =
    readMetaBoolean(meta, ["hybrid", "is_hybrid", "isHybrid"], false) ||
    /hybrid/i.test(`${name} ${category} ${drivetrain}`);
  const description = toStringValue(
    meta.description,
    "Reliable rental option for Jamaica travel.",
  );
  const images = toImageArray(row.image_urls_json);
  const legacyId = toStringValue(meta.legacy_id, "");
  const slug = toStringValue(meta.slug, slugify(legacyId || `${row.make}-${row.model}-${row.year}`));

  return {
    id: row.id,
    name,
    category,
    transmission,
    seats,
    bags,
    pricePerDay: row.daily_rate_cents,
    images: images.length > 0 ? images : ["/window.svg"],
    featured: toBooleanValue(meta.featured, false),
    description,
    make: row.make,
    model: row.model,
    year: row.year,
    daily_rate_cents: row.daily_rate_cents,
    deposit_cents: row.deposit_cents,
    security_deposit_jmd: resolveVehicleSecurityDepositJmd(settings, {
      id: row.id,
      make: row.make,
      model: row.model,
      name,
    }),
    status: row.status,
    slug,
    legacyId: legacyId || null,
    doors,
    fuelPolicy,
    mileagePolicy,
    airConditioning,
    hybrid,
    drivetrain,
  };
}

export async function getPublicVehicles(): Promise<PublicVehicle[]> {
  const [{ settings }, result] = await Promise.all([
    loadAdminSettings(),
    dbQuery<VehicleRow>(
      "select id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, created_at, features_json, image_urls_json from vehicles where deleted_at is null and upper(coalesce(status, '')) not in ('INACTIVE', 'UNAVAILABLE', 'MAINTENANCE') and lower(coalesce(features_json->>'public_visible', 'false')) in ('true','1','yes') order by case when (features_json->>'public_order') ~ '^[0-9]+$' then (features_json->>'public_order')::int else 9999 end asc, created_at desc",
    ),
  ]);

  const mapped: Array<PublicVehicle | null> = result.rows.map((row: VehicleRow) =>
    mapRowToPublicVehicle(row, settings),
  );
  return mapped.filter((vehicle): vehicle is PublicVehicle => vehicle !== null);
}

export async function getPublicVehiclesAvailableForWindow(
  input: AvailabilityWindowInput,
): Promise<PublicVehicle[]> {
  const window = toNormalizedAvailabilityWindow(input);
  if (!window) return [];

  const vehicles = await getPublicVehicles();
  if (vehicles.length === 0) return [];

  return listAvailableVehiclesWithAvailabilityRules(
    vehicles,
    { startAt: window.startAtIso, endAt: window.endAtIso },
    { includeBlockouts: true },
  );
}

export async function isPublicVehicleUnavailableForWindow(
  vehicleId: string,
  input: AvailabilityWindowInput,
): Promise<boolean> {
  const window = toNormalizedAvailabilityWindow(input);
  if (!window || !UUID_REGEX.test(vehicleId)) return true;
  const result = await isVehicleUnavailableWithAvailabilityRules(
    {
      vehicleId,
      startAt: window.startAtIso,
      endAt: window.endAtIso,
    },
    { includeBlockouts: true },
  );
  return result.unavailable;
}

export async function getPublicVehicleByIdentifier(identifier: string): Promise<PublicVehicle | null> {
  const normalized = identifier.trim();
  if (!normalized) return null;

  const [{ settings }, result] = await Promise.all([
    loadAdminSettings(),
    dbQuery<VehicleRow>(
      "select id, make, model, year, seat_count, daily_rate_cents, deposit_cents, status, created_at, features_json, image_urls_json from vehicles where deleted_at is null and upper(coalesce(status, '')) not in ('INACTIVE', 'UNAVAILABLE', 'MAINTENANCE') and lower(coalesce(features_json->>'public_visible', 'false')) in ('true','1','yes') and (id::text = $1 or features_json->>'slug' = $1 or features_json->>'legacy_id' = $1) order by created_at desc limit 1",
      [normalized],
    ),
  ]);

  if (result.rows.length === 0) return null;
  return mapRowToPublicVehicle(result.rows[0], settings);
}
