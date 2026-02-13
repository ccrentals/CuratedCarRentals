#!/usr/bin/env tsx

import path from "node:path";

import dotenv from "dotenv";
import { Pool } from "pg";

import { vehicles } from "../src/data/vehicles";
import { siteContent } from "../src/data/content";

type LegacyVehicleSeed = {
  legacyId: string;
  make: string;
  model: string;
  year: number;
  dailyRate: number;
  deposit: number;
  imageUrls: string[];
  features: Record<string, unknown>;
};

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

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  const make = parts.shift() ?? "Vehicle";
  const model = parts.join(" ") || "Model";
  return { make, model };
}

function inferYearFromImages(imageUrls: string[]): number {
  for (const image of imageUrls) {
    const match = image.match(/(19|20)\d{2}/);
    if (match) return Number(match[0]);
  }
  return 2020;
}

function toLegacySeed(): LegacyVehicleSeed[] {
  return vehicles.map((vehicle, index) => {
    const { make, model } = splitName(vehicle.name);
    const year = inferYearFromImages(vehicle.images);
    const dailyRate = Math.round(vehicle.pricePerDay);
    const deposit = Math.max(1, Math.round(dailyRate * siteContent.bookingDepositRate));

    return {
      legacyId: vehicle.id,
      make,
      model,
      year,
      dailyRate,
      deposit,
      imageUrls: vehicle.images,
      features: {
        source: "frontend_seed",
        legacy_id: vehicle.id,
        slug: vehicle.id,
        name: vehicle.name,
        category: vehicle.category,
        transmission: vehicle.transmission,
        seats: vehicle.seats,
        bags: vehicle.bags,
        description: vehicle.description,
        featured: Boolean(vehicle.featured),
        public_visible: true,
        public_order: index + 1,
      },
    };
  });
}

async function main() {
  loadEnv();
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const seedVehicles = toLegacySeed();

  const client = await pool.connect();
  try {
    await client.query("begin");

    for (const vehicle of seedVehicles) {
      const existingByLegacy = await client.query(
        "select id from vehicles where features_json->>'legacy_id' = $1 limit 1",
        [vehicle.legacyId],
      );

      const existingByModel =
        existingByLegacy.rowCount > 0
          ? existingByLegacy
          : await client.query(
              "select id from vehicles where lower(make) = lower($1) and lower(model) = lower($2) and year = $3 order by created_at asc limit 1",
              [vehicle.make, vehicle.model, vehicle.year],
            );

      if (existingByModel.rowCount > 0) {
        await client.query(
          "update vehicles set make = $1, model = $2, year = $3, daily_rate_cents = $4, deposit_cents = $5, status = 'AVAILABLE', image_urls_json = $6::jsonb, features_json = coalesce(case when jsonb_typeof(features_json) = 'object' then features_json else '{}'::jsonb end, '{}'::jsonb) || $7::jsonb, updated_at = now() where id = $8",
          [
            vehicle.make,
            vehicle.model,
            vehicle.year,
            vehicle.dailyRate,
            vehicle.deposit,
            JSON.stringify(vehicle.imageUrls),
            JSON.stringify(vehicle.features),
            existingByModel.rows[0].id,
          ],
        );
      } else {
        await client.query(
          "insert into vehicles (make, model, year, daily_rate_cents, deposit_cents, status, image_urls_json, features_json) values ($1, $2, $3, $4, $5, 'AVAILABLE', $6::jsonb, $7::jsonb)",
          [
            vehicle.make,
            vehicle.model,
            vehicle.year,
            vehicle.dailyRate,
            vehicle.deposit,
            JSON.stringify(vehicle.imageUrls),
            JSON.stringify(vehicle.features),
          ],
        );
      }
    }

    await client.query("commit");
    console.log(`Seeded ${seedVehicles.length} public vehicles from src/data/vehicles.ts`);
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
  console.error(`Public vehicle seed failed: ${message}`);
  process.exit(1);
});
