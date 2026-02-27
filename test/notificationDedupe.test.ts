import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDedupeKey,
  markDedupeResult,
  tryAcquireDedupe,
} from "@/lib/notifications/dedupe";

type QueryCall = {
  text: string;
  params: unknown[];
};

test("computeDedupeKey: builds deterministic keys", () => {
  const key = computeDedupeKey({
    entityType: "booking",
    entityId: "123e4567-e89b-42d3-a456-426614174000",
    eventType: "BOOKING_CREATED_EMAIL",
    extra: { b: "2", a: "1" },
  });

  assert.equal(
    key,
    "booking:123e4567-e89b-42d3-a456-426614174000:BOOKING_CREATED_EMAIL:a=1|b=2",
  );
});

test("notification dedupe: first send allowed, duplicate blocked, result can be marked", async () => {
  const inserts = new Set<string>();
  const calls: QueryCall[] = [];

  const query = async <T = unknown>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text.startsWith("insert into notification_dispatch_log")) {
      const dedupeKey = String(params[3] ?? "");
      if (inserts.has(dedupeKey)) {
        const duplicate = new Error("duplicate key") as Error & { code?: string };
        duplicate.code = "23505";
        throw duplicate;
      }
      inserts.add(dedupeKey);
      return { rows: [] as T[], rowCount: 1 };
    }

    if (text.startsWith("update notification_dispatch_log")) {
      return { rows: [] as T[], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const dedupeKey = computeDedupeKey({
    entityType: "payment",
    entityId: "123e4567-e89b-42d3-a456-426614174001",
    eventType: "DEPOSIT_RECEIPT_EMAIL",
    extra: "txn_1",
  });

  const first = await tryAcquireDedupe(
    {
      dedupeKey,
      entityType: "payment",
      entityId: "123e4567-e89b-42d3-a456-426614174001",
      eventType: "DEPOSIT_RECEIPT_EMAIL",
      provider: "resend",
    },
    query,
  );
  const second = await tryAcquireDedupe(
    {
      dedupeKey,
      entityType: "payment",
      entityId: "123e4567-e89b-42d3-a456-426614174001",
      eventType: "DEPOSIT_RECEIPT_EMAIL",
      provider: "resend",
    },
    query,
  );

  assert.equal(first.ok, true);
  assert.equal(first.acquired, true);
  assert.equal(second.ok, false);
  assert.equal(second.acquired, false);

  await markDedupeResult(
    {
      dedupeKey,
      status: "SENT",
      provider: "resend",
      providerMessageId: "resend-msg-123",
    },
    query,
  );

  const updateCall = calls.find((entry) =>
    entry.text.startsWith("update notification_dispatch_log"),
  );
  assert.ok(updateCall);
  assert.equal(updateCall?.params[0], dedupeKey);
  assert.equal(updateCall?.params[1], "SENT");
});
