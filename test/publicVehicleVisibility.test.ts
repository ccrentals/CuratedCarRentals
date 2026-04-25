import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { dbQuery } from "@/lib/db";
import {
  getPublicVehicles,
  getPublicVehiclesAvailableForWindow,
} from "@/lib/publicVehicles";

loadEnv({ path: ".env.local" });
loadEnv();

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed visibility tests.");
  }
}

test("public vehicle queries exclude private vehicles and include public vehicles", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `public-visible-${randomUUID().slice(0, 8)}`;
  const ids: string[] = [];

  try {
    const publicVehicle = await dbQuery<{ id: string }>(
      `insert into vehicles (
         make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json
       ) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb)
       returning id`,
      [
        "Visibility Public",
        runTag,
        2026,
        5,
        7200,
        7000,
        JSON.stringify([]),
        JSON.stringify({ slug: `visibility-public-${runTag}`, public_visible: true }),
      ],
    );
    const privateVehicle = await dbQuery<{ id: string }>(
      `insert into vehicles (
         make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json
       ) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb)
       returning id`,
      [
        "Visibility Private",
        runTag,
        2026,
        5,
        7200,
        7000,
        JSON.stringify([]),
        JSON.stringify({ slug: `visibility-private-${runTag}`, public_visible: false }),
      ],
    );
    ids.push(publicVehicle.rows[0].id, privateVehicle.rows[0].id);

    const publicVehicles = await getPublicVehicles();
    const availableVehicles = await getPublicVehiclesAvailableForWindow({
      pickupDate: "2030-01-10",
      dropoffDate: "2030-01-12",
      pickupTime: "10:00",
      dropoffTime: "10:00",
    });

    assert.equal(publicVehicles.some((vehicle) => vehicle.id === publicVehicle.rows[0].id), true);
    assert.equal(publicVehicles.some((vehicle) => vehicle.id === privateVehicle.rows[0].id), false);
    assert.equal(availableVehicles.some((vehicle) => vehicle.id === publicVehicle.rows[0].id), true);
    assert.equal(availableVehicles.some((vehicle) => vehicle.id === privateVehicle.rows[0].id), false);
  } finally {
    if (ids.length > 0) {
      await dbQuery("delete from vehicles where id = any($1::uuid[])", [ids]);
    }
  }
});

test("public vehicle queries exclude unavailable, maintenance, and inactive vehicles", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `public-status-${randomUUID().slice(0, 8)}`;
  const ids: string[] = [];

  try {
    for (const [make, status] of [
      ["Status Unavailable", "UNAVAILABLE"],
      ["Status Maintenance", "MAINTENANCE"],
      ["Status Inactive", "INACTIVE"],
    ] as const) {
      const result = await dbQuery<{ id: string }>(
        `insert into vehicles (
           make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json
         ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
         returning id`,
        [
          make,
          runTag,
          2026,
          5,
          7200,
          7000,
          status,
          JSON.stringify([]),
          JSON.stringify({ slug: `${make.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${runTag}`, public_visible: true }),
        ],
      );
      ids.push(result.rows[0].id);
    }

    const publicVehicles = await getPublicVehicles();
    const availableVehicles = await getPublicVehiclesAvailableForWindow({
      pickupDate: "2030-01-10",
      dropoffDate: "2030-01-12",
      pickupTime: "10:00",
      dropoffTime: "10:00",
    });

    for (const id of ids) {
      assert.equal(publicVehicles.some((vehicle) => vehicle.id === id), false);
      assert.equal(availableVehicles.some((vehicle) => vehicle.id === id), false);
    }
  } finally {
    if (ids.length > 0) {
      await dbQuery("delete from vehicles where id = any($1::uuid[])", [ids]);
    }
  }
});

test("public vehicle queries drop malformed remote image URLs", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `public-images-${randomUUID().slice(0, 8)}`;
  const ids: string[] = [];

  try {
    const result = await dbQuery<{ id: string }>(
      `insert into vehicles (
         make, model, year, seat_count, daily_rate_cents, deposit_cents, status, image_urls_json, features_json
       ) values ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7::jsonb, $8::jsonb)
       returning id`,
      [
        "Image Guard",
        runTag,
        2026,
        5,
        7200,
        7000,
        JSON.stringify(["https://base/bad-image.jpg"]),
        JSON.stringify({ slug: `image-guard-${runTag}`, public_visible: true }),
      ],
    );
    ids.push(result.rows[0].id);

    const publicVehicles = await getPublicVehicles();
    const vehicle = publicVehicles.find((item) => item.id === result.rows[0].id);

    assert.ok(vehicle);
    assert.deepEqual(vehicle.images, ["/window.svg"]);
  } finally {
    if (ids.length > 0) {
      await dbQuery("delete from vehicles where id = any($1::uuid[])", [ids]);
    }
  }
});
