#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { Pool } from "pg";

type E2EFixtures = {
  runId: string;
  adminUser?: {
    id?: string | null;
    email?: string | null;
    createdBySeed?: boolean;
  };
  vehicle?: { id?: string };
  bookingLocations?: {
    pickup?: { id?: string };
    dropoff?: { id?: string };
  };
  customer?: { id?: string; email?: string };
  insurancePlan?: { id?: string };
  depreciationProfile?: { id?: string };
  maintenance?: { recordId?: string; blockoutId?: string | null };
  document?: { id?: string | null };
  promoCodes?: {
    active?: { id?: string };
    scheduled?: { id?: string };
    expired?: { id?: string };
    limitReached?: { id?: string };
    inactive?: { id?: string };
    vehicleRestricted?: { id?: string };
    blackoutRestricted?: { id?: string };
    perCustomerLimited?: { id?: string };
    reconstructedHistory?: { id?: string };
    fillers?: Array<{ id?: string }>;
  };
};

const FIXTURES_PATH = path.join(process.cwd(), ".artifacts", "e2e-fixtures.json");

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
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

async function tableExists(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, tableName: string) {
  const result = await client.query(
    "select to_regclass($1) is not null as exists",
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

function readFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) return null;
  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  const parsed = JSON.parse(raw) as E2EFixtures;
  if (!parsed || typeof parsed !== "object" || typeof parsed.runId !== "string") {
    throw new Error("Fixture file is invalid.");
  }
  return parsed;
}

async function main() {
  loadEnv();

  const fixtures = readFixtures();
  if (!fixtures) {
    console.log("No .artifacts/e2e-fixtures.json found. Nothing to clean.");
    return;
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is not set");

  const vehicleId = fixtures.vehicle?.id ?? null;
  const maintenanceRecordId = fixtures.maintenance?.recordId ?? null;
  const blockoutId = fixtures.maintenance?.blockoutId ?? null;
  const depreciationProfileId = fixtures.depreciationProfile?.id ?? null;
  const insurancePlanId = fixtures.insurancePlan?.id ?? null;
  const customerId = fixtures.customer?.id ?? null;
  const customerEmail = fixtures.customer?.email ?? null;
  const documentId = fixtures.document?.id ?? null;
  const adminUserId = fixtures.adminUser?.id ?? null;
  const adminUserEmail = fixtures.adminUser?.email ?? null;
  const adminUserCreatedBySeed = fixtures.adminUser?.createdBySeed === true;
  const pickupLocationId = fixtures.bookingLocations?.pickup?.id ?? null;
  const dropoffLocationId = fixtures.bookingLocations?.dropoff?.id ?? null;
  const promoIds = [
    fixtures.promoCodes?.active?.id,
    fixtures.promoCodes?.scheduled?.id,
    fixtures.promoCodes?.expired?.id,
    fixtures.promoCodes?.limitReached?.id,
    fixtures.promoCodes?.inactive?.id,
    fixtures.promoCodes?.vehicleRestricted?.id,
    fixtures.promoCodes?.blackoutRestricted?.id,
    fixtures.promoCodes?.perCustomerLimited?.id,
    fixtures.promoCodes?.reconstructedHistory?.id,
    ...(fixtures.promoCodes?.fillers?.map((entry) => entry.id) ?? []),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const runMarker = `%${fixtures.runId}%`;

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const client = await pool.connect();

  try {
    await client.query("begin");

    const removed: Record<string, number> = {};

    const remove = async (table: string, sql: string, values: unknown[]) => {
      if (!(await tableExists(client, table))) return;
      const result = await client.query(sql, values);
      removed[table] = (removed[table] ?? 0) + result.rowCount;
    };

    await remove(
      "quote_events",
      `delete from quote_events
       where quote_id in (
         select id
         from quotes
         where customer_email ilike $1
            or customer_full_name ilike $1
       )`,
      [runMarker],
    );

    await remove(
      "quote_emails",
      `delete from quote_emails
       where quote_id in (
         select id
         from quotes
         where customer_email ilike $1
            or customer_full_name ilike $1
       )`,
      [runMarker],
    );

    await remove(
      "quotes",
      `delete from quotes
       where customer_email ilike $1
          or customer_full_name ilike $1`,
      [runMarker],
    );

    await remove(
      "vehicle_documents",
      `delete from vehicle_documents
       where ($1::uuid is not null and id = $1::uuid)
          or (vehicle_id = $2::uuid and title ilike $3)`,
      [documentId, vehicleId, runMarker],
    );

    await remove(
      "vehicle_maintenance_status_history",
      `delete from vehicle_maintenance_status_history
       where ($1::uuid is not null and maintenance_record_id = $1::uuid)
          or (vehicle_id = $2::uuid and note ilike $3)`,
      [maintenanceRecordId, vehicleId, runMarker],
    );

    await remove(
      "blockouts",
      `delete from blockouts
       where ($1::uuid is not null and id = $1::uuid)
          or ($2::uuid is not null and linked_maintenance_id = $2::uuid)
          or ($3::uuid is not null and vehicle_id = $3::uuid and reason ilike $4)`,
      [blockoutId, maintenanceRecordId, vehicleId, runMarker],
    );

    await remove(
      "vehicle_maintenance_records",
      `delete from vehicle_maintenance_records
       where ($1::uuid is not null and id = $1::uuid)
          or ($2::uuid is not null and vehicle_id = $2::uuid and title ilike $3)`,
      [maintenanceRecordId, vehicleId, runMarker],
    );

    await remove(
      "vehicle_depreciation_snapshots",
      `delete from vehicle_depreciation_snapshots
       where vehicle_id = $1::uuid`,
      [vehicleId],
    );

    await remove(
      "vehicle_depreciation_profiles",
      `delete from vehicle_depreciation_profiles
       where ($1::uuid is not null and id = $1::uuid)
          or vehicle_id = $2::uuid`,
      [depreciationProfileId, vehicleId],
    );

    await remove(
      "insurance_plans",
      `delete from insurance_plans
       where ($1::uuid is not null and id = $1::uuid)
          or vehicle_id = $2::uuid`,
      [insurancePlanId, vehicleId],
    );

    await remove(
      "bookings",
      `delete from bookings
       where ($1::uuid is not null and vehicle_id = $1::uuid)
          or ($2::uuid is not null and customer_id = $2::uuid)
          or exists (
            select 1
            from customers c
            where c.id = bookings.customer_id
              and c.email ilike $3
          )`,
      [vehicleId, customerId, runMarker],
    );

    if (promoIds.length > 0) {
      await remove("promo_codes", "delete from promo_codes where id = any($1::uuid[])", [promoIds]);
    }

    await remove(
      "booking_locations",
      `delete from booking_locations
       where id = any(
         array_remove(array[$1::uuid, $2::uuid], null)
       )`,
      [pickupLocationId, dropoffLocationId],
    );

    await remove(
      "customers",
      `delete from customers
       where ($1::uuid is not null and id = $1::uuid)
          or ($2::text is not null and email = $2)
          or (email ilike $3)`,
      [customerId, customerEmail, runMarker],
    );

    await remove("vehicle_profiles", "delete from vehicle_profiles where vehicle_id = $1::uuid", [vehicleId]);
    await remove("vehicles", "delete from vehicles where id = $1::uuid", [vehicleId]);

    if (adminUserCreatedBySeed && adminUserId) {
      await remove(
        "users",
        `delete from users
         where id = $1::uuid
           and ($2::text is null or email = $2)`,
        [adminUserId, adminUserEmail],
      );
    }

    await client.query("commit");

    fs.rmSync(FIXTURES_PATH, { force: true });

    console.log("E2E cleanup complete:");
    console.log(
      JSON.stringify(
        {
          runId: fixtures.runId,
          removed,
          fixturesRemoved: true,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E2E cleanup failed: ${message}`);
  process.exit(1);
});
