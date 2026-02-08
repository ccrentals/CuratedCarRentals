import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { logError } from "@/lib/log";

function pick(body: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (body[key]) return String(body[key]);
  }
  return "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, any> | null;
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
  const eventId = pick(body, ["event_id", "eventId"]) || transactionId || orderId;

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "Missing order_id" }, { status: 400 });
  }

  if (eventId) {
    try {
      await dbQuery(
        "insert into webhook_events (provider, event_id) values ($1, $2) on conflict (provider, event_id) do nothing",
        ["WIPAY", eventId],
      );
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
    return NextResponse.json({ ok: false, reason: result.reason ?? "failed" });
  }

  return NextResponse.json({ ok: true, bookingId: result.bookingId });
}
