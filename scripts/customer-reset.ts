#!/usr/bin/env tsx

import path from "node:path";
import { pathToFileURL } from "node:url";

import dotenv from "dotenv";
import { Pool } from "pg";

import { CUSTOMER_FLEET_BOOTSTRAP } from "../src/data/customerFleetBootstrap";
import { createCanonicalBookingLocationSeedConfigs } from "../src/lib/bookings/bookingLocations";
import { resolveUploadcareCdnUrl, uploadRemoteFileUrlToUploadcareFileId } from "../src/lib/uploads/uploadcare";

type CountMap = Record<string, number>;

type QueryResultRow = Record<string, unknown>;

type QueryableClient = {
  query: <TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: TRow[]; rowCount: number | null }>;
};

type VehicleGalleryEntry = {
  name: string;
  uploadcareFileId: string;
  url: string;
  position: number;
  sourceUrl: string;
};

const RESET_CONFIRMATION_VALUE = "LOCAL_ONLY";

function formatPublicId(prefix: string, value: number) {
  return `${prefix}${String(value).padStart(6, "0")}`;
}

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function requireResetConfirmation(apply: boolean) {
  if (!apply) return;
  const confirmation = (process.env.CUSTOMER_RESET_CONFIRM ?? "").trim();
  if (confirmation !== RESET_CONFIRMATION_VALUE) {
    throw new Error(
      `Customer reset requires CUSTOMER_RESET_CONFIRM=${RESET_CONFIRMATION_VALUE} to guard destructive local cleanup.`,
    );
  }
}

function normalizeDatabaseUrl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const params = url.searchParams;
    const libpqCompat = params.get("uselibpqcompat") === "true";

    if (libpqCompat) {
      if (!params.get("sslmode")) params.set("sslmode", "require");
      url.search = params.toString();
      return url.toString();
    }

    const sslmode = (params.get("sslmode") ?? "").toLowerCase();
    if (!sslmode) {
      params.set("sslmode", "verify-full");
    } else if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      params.set("sslmode", "verify-full");
    }

    url.search = params.toString();
    return url.toString();
  } catch {
    return connectionString;
  }
}

async function tableExists(client: QueryableClient, tableName: string) {
  const result = await client.query<{ exists: boolean }>(
    "select to_regclass($1) is not null as exists",
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

async function countRows(client: QueryableClient, tableName: string) {
  if (!(await tableExists(client, tableName))) return 0;
  const result = await client.query<{ count: string }>(`select count(*)::text as count from ${tableName}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function snapshotCounts(client: QueryableClient): Promise<CountMap> {
  const tables = [
    "users",
    "customers",
    "vehicles",
    "bookings",
    "payments",
    "quotes",
    "promo_codes",
    "booking_locations",
    "vehicle_documents",
    "vehicle_maintenance_records",
    "blockouts",
  ] as const;

  const entries = await Promise.all(
    tables.map(async (table) => [table, await countRows(client, table)] as const),
  );
  return Object.fromEntries(entries);
}

export async function syncPublicIdSequence(
  client: QueryableClient,
  sequenceName: string,
) {
  await client.query("select setval($1, 1, false)", [sequenceName]);
}

async function deleteAndCount(
  client: QueryableClient,
  key: string,
  sql: string,
  values: unknown[] = [],
) {
  const result = await client.query(sql, values);
  return { key, count: result.rowCount ?? 0 };
}

type CustomerResetDeps = {
  uploadRemoteFile: typeof uploadRemoteFileUrlToUploadcareFileId;
  resolveUploadcareUrl: typeof resolveUploadcareCdnUrl;
};

const DEFAULT_RESET_DEPS: CustomerResetDeps = {
  uploadRemoteFile: uploadRemoteFileUrlToUploadcareFileId,
  resolveUploadcareUrl: resolveUploadcareCdnUrl,
};

export async function runApply(
  client: QueryableClient,
  deps: CustomerResetDeps = DEFAULT_RESET_DEPS,
) {
  const operations = [
    ["quote_emails", "delete from quote_emails"],
    ["quote_events", "delete from quote_events"],
    ["quotes", "delete from quotes"],
    ["promo_redemption_events", "delete from promo_redemption_events"],
    ["promo_redemptions", "delete from promo_redemptions"],
    ["promo_codes", "delete from promo_codes"],
    ["bookings", "delete from bookings"],
    ["booking_locations", "delete from booking_locations"],
    ["vehicles", "delete from vehicles"],
  ] as const;

  for (const [key, sql] of operations) {
    if (!(await tableExists(client, key))) continue;
    await deleteAndCount(client, key, sql);
  }

  if (await tableExists(client, "customers")) {
    await client.query(
      "update customers set last_booked_at = null where not exists (select 1 from bookings b where b.customer_id = customers.id)",
    );
  }

  if (await tableExists(client, "booking_locations")) {
    const canonicalLocations = createCanonicalBookingLocationSeedConfigs();
    for (const location of canonicalLocations) {
      await client.query(
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
           field_schema_json
         )
         values ($1, $2, $3, $4, $5, $6, $5, $6, true, $7, $8::jsonb)`,
        [
          location.label,
          location.locationTypeKey,
          location.pickupLabel,
          location.dropoffLabel,
          location.appliesToPickup,
          location.appliesToDropoff,
          location.sortOrder,
          JSON.stringify(
            location.fieldSchema.map((field) => ({
              key: field.key,
              label: field.label,
              input_type: field.inputType,
              required: field.required,
              applies_to: field.appliesTo,
              default_source: field.defaultSource,
            })),
          ),
        ],
      );
    }
  }

  await syncPublicIdSequence(client, "vehicles_public_id_seq");
  await syncPublicIdSequence(client, "bookings_public_id_seq");
  await syncPublicIdSequence(client, "payments_public_id_seq");
  await syncPublicIdSequence(client, "quotes_public_id_seq");
  await syncPublicIdSequence(client, "promo_codes_public_id_seq");
  await syncPublicIdSequence(client, "vehicle_maintenance_records_public_id_seq");

  let insertedVehicles = 0;
  for (const [index, vehicle] of CUSTOMER_FLEET_BOOTSTRAP.entries()) {
    const predictedPublicId = formatPublicId("VE", index + 1);
    const galleryEntries: VehicleGalleryEntry[] = [];

    for (const [imageIndex, sourceUrl] of vehicle.sourceImages.entries()) {
      const position = imageIndex + 1;
      const fileName = `${predictedPublicId}-${vehicle.slug}-gallery-${String(position).padStart(2, "0")}.png`;
      const uploadcareFileId = await deps.uploadRemoteFile(sourceUrl, { fileName });
      const uploadcareUrl = await deps.resolveUploadcareUrl(uploadcareFileId);
      galleryEntries.push({
        name: `${predictedPublicId}-${vehicle.slug}-gallery-${String(position).padStart(2, "0")}`,
        uploadcareFileId,
        url: uploadcareUrl,
        position,
        sourceUrl,
      });
    }

    const features = {
      source: "customer_bootstrap",
      legacy_id: vehicle.legacyId,
      slug: vehicle.slug,
      name: vehicle.name,
      category: vehicle.category,
      transmission: vehicle.transmission,
      seats: vehicle.seats,
      bags: vehicle.bags,
      description: vehicle.description,
      featured: Boolean(vehicle.featured),
      public_visible: true,
      public_order: vehicle.publicOrder,
      gallery_images: galleryEntries,
    };

    await client.query(
      `insert into vehicles (
         make,
         model,
         year,
         seat_count,
         daily_rate_cents,
         deposit_cents,
         status,
         image_urls_json,
         features_json
       ) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb)
       returning id`,
      [
        vehicle.make,
        vehicle.model,
        vehicle.year,
        vehicle.seats,
        vehicle.dailyRateJmd,
        vehicle.depositJmd,
        JSON.stringify(galleryEntries.map((entry) => entry.url)),
        JSON.stringify(features),
      ],
    );
    insertedVehicles += 1;
  }

  return { insertedVehicles, insertedLocations: createCanonicalBookingLocationSeedConfigs().length };
}

async function main() {
  loadEnv();

  const apply = process.argv.includes("--apply");
  requireResetConfirmation(apply);
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const client = await pool.connect();

  try {
    const before = await snapshotCounts(client);
    console.log("Customer reset target counts (before):");
    console.table(before);
    console.log(`Fleet bootstrap vehicles: ${CUSTOMER_FLEET_BOOTSTRAP.length}`);

    if (!apply) {
      console.log("Dry run only. Re-run with --apply to wipe business data and reload the customer fleet bootstrap.");
      return;
    }

    await client.query("begin");
    const outcome = await runApply(client);
    await client.query("commit");

    const after = await snapshotCounts(client);
    const removed = Object.fromEntries(
      Object.entries(before).map(([key, value]) => [key, Math.max(0, value - (after[key] ?? 0))]),
    );
    console.log("Customer reset removed:");
    console.table(removed);
    console.log(`Inserted fleet vehicles: ${outcome.insertedVehicles}`);
    console.log(`Inserted booking locations: ${outcome.insertedLocations}`);
    console.log("Customer reset target counts (after):");
    console.table(after);
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // no-op
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Customer reset failed: ${message}`);
    process.exit(1);
  });
}
