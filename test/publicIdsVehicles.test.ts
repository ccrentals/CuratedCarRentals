import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { dbQuery } from "@/lib/db";
import { vehicleFilterWhereSql } from "@/lib/vehicles/adminVehicles";

loadEnv({ path: ".env.local" });
loadEnv();

type CreatedVehicle = {
  id: string;
  public_id: string;
};

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed vehicle public id tests.");
  }
}

async function insertVehicle(runTag: string) {
  const result = await dbQuery<CreatedVehicle>(
    "insert into vehicles (make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb) returning id, public_id",
    [
      `PublicID Make ${runTag}`,
      `PublicID Model ${runTag}`,
      2032,
      5,
      12345,
      70000,
      JSON.stringify([]),
      JSON.stringify({ source: "test", runTag }),
    ],
  );
  return result.rows[0];
}

async function cleanup(vehicleIds: string[]) {
  if (vehicleIds.length > 0) {
    await dbQuery("delete from vehicles where id = any($1::uuid[])", [vehicleIds]);
  }
}

test("vehicle insert auto-generates VE public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `ve-public-id-gen-${randomUUID().slice(0, 8)}`;
  const vehicleIds: string[] = [];

  try {
    const created = await insertVehicle(runTag);
    vehicleIds.push(created.id);

    assert.match(created.public_id, /^VE\d{6,}$/);
  } finally {
    await cleanup(vehicleIds);
  }
});

test("vehicle public_id remains unique across inserts", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `ve-public-id-uniq-${randomUUID().slice(0, 8)}`;
  const vehicleIds: string[] = [];

  try {
    const first = await insertVehicle(`${runTag}-1`);
    const second = await insertVehicle(`${runTag}-2`);
    vehicleIds.push(first.id, second.id);

    assert.notEqual(first.public_id, second.public_id);
  } finally {
    await cleanup(vehicleIds);
  }
});

test("vehicle admin search query matches public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `ve-public-id-search-${randomUUID().slice(0, 8)}`;
  const vehicleIds: string[] = [];

  try {
    const created = await insertVehicle(runTag);
    vehicleIds.push(created.id);

    const filter = vehicleFilterWhereSql("all", created.public_id.toLowerCase(), {
      includeProfileSearch: false,
    });
    const result = await dbQuery<{ id: string; public_id: string }>(
      `select v.id, v.public_id from vehicles v ${filter.whereSql} order by v.created_at desc, v.id::text desc`,
      filter.values,
    );

    const row = result.rows.find((item: { id: string; public_id: string }) => item.id === created.id);
    assert.ok(row);
    assert.equal(row?.public_id, created.public_id);
  } finally {
    await cleanup(vehicleIds);
  }
});
