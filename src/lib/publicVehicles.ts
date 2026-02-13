import { dbQuery } from "@/lib/db";
import type { Vehicle } from "@/data/vehicles";

export type PublicVehicle = Vehicle & {
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  slug: string;
  legacyId: string | null;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  created_at: string;
  features_json: unknown;
  image_urls_json: unknown;
};

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

function toImageArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mapRowToPublicVehicle(row: VehicleRow): PublicVehicle | null {
  if (!Number.isFinite(row.daily_rate_cents) || row.daily_rate_cents <= 0) {
    return null;
  }

  const meta = toObject(row.features_json);
  const name = toStringValue(meta.name, `${row.make} ${row.model}`.trim());
  const category = toStringValue(meta.category, "Vehicle");
  const transmissionRaw = toStringValue(meta.transmission, "Automatic");
  const transmission: "Automatic" | "Manual" =
    transmissionRaw.toLowerCase() === "manual" ? "Manual" : "Automatic";
  const seats = Math.max(1, toNumberValue(meta.seats, 5));
  const bags = Math.max(0, toNumberValue(meta.bags, 2));
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
    status: row.status,
    slug,
    legacyId: legacyId || null,
  };
}

export async function getPublicVehicles(): Promise<PublicVehicle[]> {
  const result = await dbQuery<VehicleRow>(
    "select id, make, model, year, daily_rate_cents, deposit_cents, status, created_at, features_json, image_urls_json from vehicles where status <> 'INACTIVE' and lower(coalesce(features_json->>'public_visible', 'false')) in ('true','1','yes') order by case when (features_json->>'public_order') ~ '^[0-9]+$' then (features_json->>'public_order')::int else 9999 end asc, created_at desc",
  );

  const mapped: Array<PublicVehicle | null> = result.rows.map((row: VehicleRow) =>
    mapRowToPublicVehicle(row),
  );
  return mapped.filter((vehicle): vehicle is PublicVehicle => vehicle !== null);
}

export async function getPublicVehicleByIdentifier(identifier: string): Promise<PublicVehicle | null> {
  const normalized = identifier.trim();
  if (!normalized) return null;

  const result = await dbQuery<VehicleRow>(
    "select id, make, model, year, daily_rate_cents, deposit_cents, status, created_at, features_json, image_urls_json from vehicles where status <> 'INACTIVE' and lower(coalesce(features_json->>'public_visible', 'false')) in ('true','1','yes') and (id::text = $1 or features_json->>'slug' = $1 or features_json->>'legacy_id' = $1) order by created_at desc limit 1",
    [normalized],
  );

  if (result.rows.length === 0) return null;
  return mapRowToPublicVehicle(result.rows[0]);
}
