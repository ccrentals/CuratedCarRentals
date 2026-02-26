#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

import { hashSync } from "bcryptjs";
import dotenv from "dotenv";
import { Pool } from "pg";

type E2EFixtures = {
  runId: string;
  createdAt: string;
  adminUser: {
    id: string | null;
    email: string | null;
    createdBySeed: boolean;
  };
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    label: string;
  };
  bookingLocations: {
    pickup: { id: string; label: string };
    dropoff: { id: string; label: string };
  };
  customer: {
    id: string;
    email: string;
  };
  insurancePlan: {
    id: string;
  };
  depreciationProfile: {
    id: string;
  };
  maintenance: {
    recordId: string;
    title: string;
    scheduledDate: string;
    blockoutReason: string;
    blockoutId: string | null;
  };
  document: {
    id: string | null;
  };
};

const ARTIFACTS_DIR = path.join(process.cwd(), ".artifacts");
const FIXTURES_PATH = path.join(ARTIFACTS_DIR, "e2e-fixtures.json");

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

function createRunId() {
  const time = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `tour${time}${random}`;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

async function tableHasColumn(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, tableName: string, columnName: string) {
  const result = await client.query(
    `select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2
    ) as exists`,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

async function main() {
  loadEnv();

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is not set");

  const runId = createRunId();
  const now = new Date();
  const scheduledDate = addDays(now, 3);
  const blockoutStart = new Date(scheduledDate);
  blockoutStart.setHours(9, 0, 0, 0);
  const blockoutEnd = new Date(scheduledDate);
  blockoutEnd.setHours(17, 0, 0, 0);
  const purchaseDate = addDays(now, -365 * 2);

  const vehicleMake = "E2E";
  const vehicleModel = `Tour ${runId.slice(-6).toUpperCase()}`;
  const vehicleYear = now.getFullYear();
  const pickupLabel = `E2E Pickup ${runId}`;
  const dropoffLabel = `E2E Dropoff ${runId}`;
  const customerEmail = `tour+${runId}@example.com`;
  const maintenanceTitle = `E2E Seed Maintenance ${runId}`;
  const maintenanceReason = `E2E maintenance blockout ${runId}`;

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const client = await pool.connect();

  try {
    await client.query("begin");

    const adminUserResult = await client.query(
      `select id, email
       from users
       where upper(coalesce(role, '')) in ('DEVELOPER', 'ADMIN', 'STAFF')
       order by created_at asc
       limit 1`,
    );
    let adminUserId = adminUserResult.rows[0]?.id ?? null;
    let adminUserEmail = adminUserResult.rows[0]?.email ?? null;
    let adminUserCreatedBySeed = false;

    if (!adminUserId) {
      const fallbackEmail = `e2e-admin+${runId}@example.com`;
      const fallbackUsername = `e2e_admin_${runId.slice(-8)}`.toLowerCase();
      const fallbackPasswordHash = hashSync(`e2e-temp-${runId}`, 10);

      const insertedAdmin = await client.query(
        `insert into users (
           email,
           username,
           full_name,
           password_hash,
           role,
           is_active,
           must_change_password,
           password_updated_at
         )
         values ($1, $2, $3, $4, 'ADMIN', true, false, now())
         returning id, email`,
        [fallbackEmail, fallbackUsername, "E2E Seed Admin", fallbackPasswordHash],
      );

      adminUserId = insertedAdmin.rows[0]?.id ?? null;
      adminUserEmail = insertedAdmin.rows[0]?.email ?? fallbackEmail;
      adminUserCreatedBySeed = true;
    }

    if (!adminUserId) {
      throw new Error(
        "No ADMIN/STAFF/DEVELOPER user exists and seed could not create a fallback admin user.",
      );
    }

    const vehicleFeatures = {
      source: "e2e_tour_seed",
      e2e_run_id: runId,
      public_visible: true,
      public_order: 1,
      name: `${vehicleMake} ${vehicleModel}`,
      category: "Sedan",
      transmission: "Automatic",
      seats: 5,
      bags: 2,
      featured: false,
      legacy_id: runId,
      slug: `e2e-${runId}`,
    };

    const vehicleResult = await client.query(
      `insert into vehicles (
         make,
         model,
         year,
         daily_rate_cents,
         deposit_cents,
         status,
         features_json,
         image_urls_json
       )
       values ($1, $2, $3, $4, $5, 'AVAILABLE', $6::jsonb, $7::jsonb)
       returning id`,
      [
        vehicleMake,
        vehicleModel,
        vehicleYear,
        12500,
        250000,
        JSON.stringify(vehicleFeatures),
        JSON.stringify(["/window.svg"]),
      ],
    );
    const vehicleId = vehicleResult.rows[0].id;

    await client.query(
      `insert into vehicle_profiles (
         vehicle_id,
         vehicle_type,
         vehicle_class,
         year,
         color,
         current_location_label,
         odometer_value,
         odometer_unit,
         needs_cleaning
       )
       values ($1::uuid, 'SEDAN', 'STANDARD', $2, 'Blue', 'Montego Bay', 40000, 'KM', false)
       on conflict (vehicle_id)
       do update set
         vehicle_type = excluded.vehicle_type,
         vehicle_class = excluded.vehicle_class,
         year = excluded.year,
         color = excluded.color,
         current_location_label = excluded.current_location_label,
         odometer_value = excluded.odometer_value,
         odometer_unit = excluded.odometer_unit,
         needs_cleaning = excluded.needs_cleaning,
         updated_at = now()`,
      [vehicleId, vehicleYear],
    );

    const pickupLocationResult = await client.query(
      `insert into booking_locations (
         label,
         allow_pickup,
         allow_dropoff,
         is_active,
         sort_order,
         created_by
       )
       values ($1, true, false, true, 10, $2::uuid)
       returning id`,
      [pickupLabel, adminUserId],
    );

    const dropoffLocationResult = await client.query(
      `insert into booking_locations (
         label,
         allow_pickup,
         allow_dropoff,
         is_active,
         sort_order,
         created_by
       )
       values ($1, false, true, true, 11, $2::uuid)
       returning id`,
      [dropoffLabel, adminUserId],
    );

    const customerResult = await client.query(
      `insert into customers (full_name, email, phone, notes)
       values ($1, $2, $3, $4)
       returning id`,
      [`E2E Customer ${runId}`, customerEmail, "+18765550000", `E2E seed ${runId}`],
    );

    const insurancePlanResult = await client.query(
      `insert into insurance_plans (
         vehicle_id,
         is_enabled,
         price_per_day_cents,
         is_global_default,
         created_by
       )
       values ($1::uuid, true, 1500, false, $2::uuid)
       returning id`,
      [vehicleId, adminUserId],
    );

    const depreciationProfileResult = await client.query(
      `insert into vehicle_depreciation_profiles (
         vehicle_id,
         purchase_price_cents,
         expected_rest_value_cents,
         purchase_date,
         odometer_at_purchase_km,
         depreciation_months,
         method,
         is_active,
         notes
       )
       values ($1::uuid, $2, $3, $4::date, $5, $6, 'STRAIGHT_LINE', true, $7)
       on conflict (vehicle_id)
       do update set
         purchase_price_cents = excluded.purchase_price_cents,
         expected_rest_value_cents = excluded.expected_rest_value_cents,
         purchase_date = excluded.purchase_date,
         odometer_at_purchase_km = excluded.odometer_at_purchase_km,
         depreciation_months = excluded.depreciation_months,
         method = excluded.method,
         is_active = excluded.is_active,
         notes = excluded.notes,
         updated_at = now()
       returning id`,
      [vehicleId, 450000000, 90000000, toDateOnly(purchaseDate), 35000, 60, `E2E seed ${runId}`],
    );

    const maintenanceRecordResult = await client.query(
      `insert into vehicle_maintenance_records (
         vehicle_id,
         status,
         category,
         title,
         description,
         scheduled_date,
         service_date,
         total_cost_cents,
         currency,
         priority,
         created_by_user_id
       )
       values ($1::uuid, 'SCHEDULED', 'SERVICE', $2, $3, $4::date, $5::date, 1250000, 'JMD', 'NORMAL', $6::uuid)
       returning id`,
      [
        vehicleId,
        maintenanceTitle,
        `Seed maintenance record for run ${runId}`,
        toDateOnly(scheduledDate),
        toDateOnly(scheduledDate),
        adminUserId,
      ],
    );
    const maintenanceRecordId = maintenanceRecordResult.rows[0].id;

    const hasStatusHistoryTable = await client.query(
      "select (to_regclass('public.vehicle_maintenance_status_history') is not null) as exists",
    );
    if (hasStatusHistoryTable.rows[0]?.exists) {
      await client.query(
        `insert into vehicle_maintenance_status_history (
           maintenance_record_id,
           vehicle_id,
           previous_status,
           next_status,
           note,
           changed_by_user_id
         )
         values ($1::uuid, $2::uuid, null, 'SCHEDULED', $3, $4::uuid)`,
        [maintenanceRecordId, vehicleId, `Seeded for ${runId}`, adminUserId],
      );
    }

    const hasBlockoutLinkedColumn = await tableHasColumn(client, "blockouts", "linked_maintenance_id");
    const hasBlockoutSourceColumn = await tableHasColumn(client, "blockouts", "source");

    let blockoutId: string | null = null;

    if (hasBlockoutLinkedColumn && hasBlockoutSourceColumn) {
      const blockoutResult = await client.query(
        `insert into blockouts (
           vehicle_id,
           start_at,
           end_at,
           reason,
           notes,
           created_by,
           linked_maintenance_id,
           source
         )
         values ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::uuid, $7::uuid, 'MAINTENANCE')
         returning id`,
        [
          vehicleId,
          blockoutStart.toISOString(),
          blockoutEnd.toISOString(),
          maintenanceReason,
          `Seed maintenance blockout ${runId}`,
          adminUserId,
          maintenanceRecordId,
        ],
      );
      blockoutId = blockoutResult.rows[0].id;
    } else {
      const blockoutResult = await client.query(
        `insert into blockouts (
           vehicle_id,
           start_at,
           end_at,
           reason,
           notes,
           created_by
         )
         values ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::uuid)
         returning id`,
        [
          vehicleId,
          blockoutStart.toISOString(),
          blockoutEnd.toISOString(),
          maintenanceReason,
          `Seed maintenance blockout ${runId}`,
          adminUserId,
        ],
      );
      blockoutId = blockoutResult.rows[0].id;
    }

    const hasMaintenanceRecordIdOnDocuments = await tableHasColumn(
      client,
      "vehicle_documents",
      "maintenance_record_id",
    );

    let documentId: string | null = null;

    if (hasMaintenanceRecordIdOnDocuments) {
      const docResult = await client.query(
        `insert into vehicle_documents (
           vehicle_id,
           maintenance_record_id,
           folder,
           document_type,
           title,
           storage_provider,
           storage_key,
           mime_type,
           size_bytes,
           file_size_bytes,
           tags,
           label,
           uploaded_by_user_id
         )
         values (
           $1::uuid,
           $2::uuid,
           'Maintenance',
           'SERVICE_INVOICE',
           $3,
           'UPLOADCARE_FILE_ID',
           $4,
           'application/pdf',
           128,
           128,
           '[]'::jsonb,
           'Seed Invoice',
           $5::uuid
         )
         returning id`,
        [
          vehicleId,
          maintenanceRecordId,
          `E2E Seed Invoice ${runId}`,
          `e2e-seed-${runId}.pdf`,
          adminUserId,
        ],
      );
      documentId = docResult.rows[0].id;
    }

    await client.query("commit");

    const fixtures: E2EFixtures = {
      runId,
      createdAt: new Date().toISOString(),
      adminUser: {
        id: adminUserId,
        email: adminUserEmail,
        createdBySeed: adminUserCreatedBySeed,
      },
      vehicle: {
        id: vehicleId,
        make: vehicleMake,
        model: vehicleModel,
        year: vehicleYear,
        label: `${vehicleYear} ${vehicleMake} ${vehicleModel}`,
      },
      bookingLocations: {
        pickup: { id: pickupLocationResult.rows[0].id, label: pickupLabel },
        dropoff: { id: dropoffLocationResult.rows[0].id, label: dropoffLabel },
      },
      customer: {
        id: customerResult.rows[0].id,
        email: customerEmail,
      },
      insurancePlan: {
        id: insurancePlanResult.rows[0].id,
      },
      depreciationProfile: {
        id: depreciationProfileResult.rows[0].id,
      },
      maintenance: {
        recordId: maintenanceRecordId,
        title: maintenanceTitle,
        scheduledDate: toDateOnly(scheduledDate),
        blockoutReason: maintenanceReason,
        blockoutId,
      },
      document: {
        id: documentId,
      },
    };

    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(FIXTURES_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");

    console.log("E2E seed complete:");
    console.log(
      JSON.stringify(
        {
          runId: fixtures.runId,
          vehicleId: fixtures.vehicle.id,
          maintenanceRecordId: fixtures.maintenance.recordId,
          depreciationProfileId: fixtures.depreciationProfile.id,
          fixturesPath: FIXTURES_PATH,
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
  console.error(`E2E seed failed: ${message}`);
  process.exit(1);
});
