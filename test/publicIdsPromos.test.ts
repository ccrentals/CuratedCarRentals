import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { fetchAdminPromoCodeById } from "@/app/api/admin/promo-codes/[id]/route";
import { fetchAdminPromoCodes } from "@/app/api/admin/promo-codes/route";
import { dbQuery } from "@/lib/db";

loadEnv({ path: ".env.local" });
loadEnv();

type CreatedPromo = {
  id: string;
  public_id: string;
  code: string;
};

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed promo public id tests.");
  }
}

async function insertPromo(runTag: string, options: { publicId?: string } = {}) {
  const result = await dbQuery<CreatedPromo>(
    "insert into promo_codes (code, is_active, discount_type, discount_value, min_subtotal_cents, max_redemptions, max_redemptions_per_customer, start_at, end_at, allowed_vehicle_ids_json, excluded_vehicle_ids_json, blackout_dates_json, public_id) values ($1, $2, $3, $4, $5, $6, $7, null, null, $8::jsonb, $9::jsonb, $10::jsonb, $11) returning id, public_id, code",
    [
      `PRTEST-${runTag}`.toUpperCase(),
      true,
      "FIXED",
      1500,
      10000,
      null,
      null,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      options.publicId ?? null,
    ],
  );
  return result.rows[0];
}

async function cleanup(promoIds: string[]) {
  if (promoIds.length > 0) {
    await dbQuery("delete from promo_codes where id = any($1::uuid[])", [promoIds]);
  }
}

test("promo insert auto-generates PR public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `pr-public-id-${randomUUID().slice(0, 8)}`;
  const promoIds: string[] = [];

  try {
    const promo = await insertPromo(runTag);
    promoIds.push(promo.id);

    assert.match(promo.public_id, /^PR\d{6,}$/);
  } finally {
    await cleanup(promoIds);
  }
});

test("promo public_id unique index rejects duplicates", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `pr-public-id-uniq-${randomUUID().slice(0, 8)}`;
  const promoIds: string[] = [];

  try {
    const first = await insertPromo(`${runTag}-1`);
    promoIds.push(first.id);

    await assert.rejects(
      () =>
        insertPromo(`${runTag}-2`, {
          publicId: first.public_id,
        }),
      (error: unknown) => {
        const code = (error as { code?: string } | null)?.code;
        return code === "23505";
      },
    );
  } finally {
    await cleanup(promoIds);
  }
});

test("admin promo search + detail include promo public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `pr-public-id-search-${randomUUID().slice(0, 8)}`;
  const promoIds: string[] = [];

  try {
    const promo = await insertPromo(runTag);
    promoIds.push(promo.id);

    const list = (await fetchAdminPromoCodes({ q: promo.public_id.toLowerCase() })) as Array<{
      id: string;
      public_id: string;
    }>;
    const found = list.find((item: { id: string; public_id: string }) => item.id === promo.id);
    assert.ok(found);
    assert.equal(found?.public_id, promo.public_id);

    const detail = await fetchAdminPromoCodeById(promo.id);
    assert.ok(detail);
    assert.equal(detail?.public_id, promo.public_id);
  } finally {
    await cleanup(promoIds);
  }
});
