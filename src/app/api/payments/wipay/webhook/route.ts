import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { logError } from "@/lib/log";

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pick(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function mapFailureStatus(reason: Awaited<ReturnType<typeof reconcileWiPayPayment>>["reason"]) {
  if (reason === "bad_hash") return 400;
  if (reason === "failed_status" || reason === "overlap") return 409;
  if (reason === "not_found") return 404;
  return 500;
}

export async function POST(request: Request) {
  const body = parseJsonObject(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const orderId = pick(body, ["order_id", "orderId", "order"]);
  const transactionId = pick(body, ["transaction_id", "transactionId", "transaction"]);
  const status = pick(body, ["status"]);
  const message = pick(body, ["message"]);
  const total = pick(body, ["total"]);
  const currency = pick(body, ["currency"]);
  const hash = pick(body, ["hash"]);
  const statusNormalized = status.toLowerCase();
  const rawEventId = pick(body, ["event_id", "eventId"]);
  // Some providers omit event IDs; derive a stable ID per transaction + status to
  // avoid treating "pending" and "success" as the same event.
  const eventId =
    rawEventId || (transactionId || orderId ? `${transactionId || orderId}:${statusNormalized || "unknown"}` : "");

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "Missing order_id" }, { status: 400 });
  }

  if (eventId) {
    try {
      // Gate: if this event has already been received, short-circuit and do not reconcile again.
      const inserted = await dbQuery<{ id: string }>(
        "insert into webhook_events (provider, event_id) values ($1, $2) on conflict (provider, event_id) do nothing returning id",
        ["WIPAY", eventId],
      );
      if (inserted.rowCount === 0) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
    } catch (error) {
      logError("wipay_webhook_event_insert_failed", error, { eventId });
    }
  }

  const result = await reconcileWiPayPayment({
    orderId,
    transactionId,
    status,
    message,
    total,
    currency,
    hash,
    source: "webhook",
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason ?? "failed" },
      { status: mapFailureStatus(result.reason) },
    );
  }

  return NextResponse.json({ ok: true, bookingId: result.bookingId });
}
