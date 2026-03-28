import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { handleAdminQuotePatch } from "@/app/api/admin/quotes/[id]/route";
import { handleAdminQuotesGet } from "@/app/api/admin/quotes/route";
import { dbQuery } from "@/lib/db";
import { fetchAdminQuotesPage, updateAdminQuote } from "@/lib/quotes/adminQuotes";

loadEnv({ path: ".env.local" });
loadEnv();

function adminSession(userId = "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b") {
  return {
    userId,
    role: "ADMIN",
    expiresAt: Date.now() + 60_000,
    issuedAt: Date.now(),
  };
}

async function insertTestQuote(input: {
  status: "SENT";
  expiresAt: string;
  runTag: string;
  suffix: string;
  vehicleId?: string | null;
}) {
  const email = `${input.runTag}-${input.suffix}@example.com`;
  const result = await dbQuery<{ id: string }>(
    "insert into quotes (status, expires_at, customer_full_name, customer_email, start_at, end_at, pickup_location_text, dropoff_location_text, vehicle_id, vehicle_label, pricing_json, base_total_cents, insurance_total_cents, discount_total_cents, subtotal_cents, total_cents, deposit_required_cents, amount_due_cents, insurance_enabled, tags) values ($1, $2::timestamptz, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9::uuid, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20::text[]) returning id",
    [
      input.status,
      input.expiresAt,
      `Batch A Quote ${input.runTag}`,
      email,
      "2031-01-01T10:00:00.000Z",
      "2031-01-03T10:00:00.000Z",
      "Montego Bay Airport",
      "Montego Bay Airport",
      input.vehicleId ?? null,
      `Batch A Vehicle ${input.runTag}`,
      JSON.stringify({
        total_cents: 24000,
        subtotal_cents: 24000,
        deposit_required_cents: 8000,
        amount_due_cents: 24000,
      }),
      24000,
      0,
      0,
      24000,
      24000,
      8000,
      24000,
      false,
      [],
    ],
  );
  return result.rows[0].id;
}

async function loadAnyVehicleId() {
  const result = await dbQuery<{ id: string }>(
    "select id from vehicles where deleted_at is null order by created_at asc limit 1",
    [],
  );
  return result.rows[0]?.id ?? null;
}

async function loadAnyActorUserId() {
  const result = await dbQuery<{ id: string }>(
    "select id from users order by created_at asc limit 1",
    [],
  );
  return result.rows[0]?.id ?? null;
}

async function deleteQuotes(ids: string[]) {
  if (ids.length === 0) return;
  await dbQuery("delete from quotes where id = any($1::uuid[])", [ids]);
}

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed quote expiry verification.");
  }
}

test("derived expiry list filter: SENT excludes past-expired quote while EXPIRED includes it", async (t) => {
  requireDatabaseOrSkip(t);
  const ids: string[] = [];
  const runTag = `quote-expiry-${randomUUID().slice(0, 8)}`;

  try {
    const pastQuoteId = await insertTestQuote({
      status: "SENT",
      expiresAt: "2020-01-01T00:00:00.000Z",
      runTag,
      suffix: "past",
    });
    ids.push(pastQuoteId);

    const futureQuoteId = await insertTestQuote({
      status: "SENT",
      expiresAt: "2035-01-01T00:00:00.000Z",
      runTag,
      suffix: "future",
    });
    ids.push(futureQuoteId);

    const deps = {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      fetchPage: fetchAdminQuotesPage,
      createQuote: async () => {
        throw new Error("not used in GET");
      },
    };

    const sentResponse = await handleAdminQuotesGet(
      new Request(
        `http://localhost/api/admin/quotes?status=SENT&q=${encodeURIComponent(runTag)}&limit=50`,
      ),
      deps,
    );
    assert.equal(sentResponse.status, 200);
    const sentPayload = (await sentResponse.json()) as {
      ok: boolean;
      items: Array<{ id: string; status: string }>;
    };
    assert.equal(sentPayload.ok, true);
    assert.equal(sentPayload.items.some((item) => item.id === pastQuoteId), false);
    assert.equal(sentPayload.items.some((item) => item.id === futureQuoteId), true);

    const expiredResponse = await handleAdminQuotesGet(
      new Request(
        `http://localhost/api/admin/quotes?status=EXPIRED&q=${encodeURIComponent(runTag)}&limit=50`,
      ),
      deps,
    );
    assert.equal(expiredResponse.status, 200);
    const expiredPayload = (await expiredResponse.json()) as {
      ok: boolean;
      items: Array<{ id: string; status: string }>;
    };
    assert.equal(expiredPayload.ok, true);
    const pastItem = expiredPayload.items.find((item) => item.id === pastQuoteId);
    assert.ok(pastItem);
    assert.equal(pastItem.status, "EXPIRED");
  } finally {
    await deleteQuotes(ids);
  }
});

test("PATCH on effectively expired quote can be reactivated when expiry is moved forward", async (t) => {
  requireDatabaseOrSkip(t);
  const ids: string[] = [];
  const runTag = `quote-expired-patch-${randomUUID().slice(0, 8)}`;
  const vehicleId = await loadAnyVehicleId();
  const adminUserId = await loadAnyActorUserId();
  if (!vehicleId) {
    t.skip("No vehicle rows available; skipping DB-backed quote expiry patch verification.");
  }
  if (!adminUserId) {
    t.skip("No admin user rows available; skipping DB-backed quote expiry patch verification.");
  }

  try {
    const quoteId = await insertTestQuote({
      status: "SENT",
      expiresAt: "2020-01-01T00:00:00.000Z",
      runTag,
      suffix: "patch",
      vehicleId,
    });
    ids.push(quoteId);

    const response = await handleAdminQuotePatch(
      new Request(`http://localhost/api/admin/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
        body: JSON.stringify({
          csrfToken: "token",
          status: "ACCEPTED",
          expiresAt: "2035-01-01T00:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: quoteId }) },
      {
        getSession: async () => adminSession(adminUserId),
        requireCsrfCheck: async () => true,
        getQuote: async () => null,
        patchQuote: updateAdminQuote,
      },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      item?: { status: string; expiresAt: string | null };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.item?.status, "ACCEPTED");
    assert.equal(payload.item?.expiresAt, "2035-01-01T00:00:00.000Z");
  } finally {
    await deleteQuotes(ids);
  }
});
