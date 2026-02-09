import { NextResponse } from "next/server";

import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { logError } from "@/lib/log";

function safeRedirect(url: string) {
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.SITE_URL ?? url.origin;
  const status = url.searchParams.get("status") ?? "";
  const message = url.searchParams.get("message") ?? "";
  const transactionId = url.searchParams.get("transaction_id") ?? "";
  const orderId = url.searchParams.get("order_id") ?? "";
  const total = url.searchParams.get("total") ?? "";
  const currency = url.searchParams.get("currency") ?? "";
  const hash = url.searchParams.get("hash") ?? "";

  if (!orderId) {
    return safeRedirect(`${origin}/payment/failed?reason=notfound`);
  }

  let result: Awaited<ReturnType<typeof reconcileWiPayPayment>>;
  try {
    result = await reconcileWiPayPayment({
      orderId,
      transactionId,
      status,
      message,
      total,
      currency,
      hash,
      source: "return",
    });
  } catch (error) {
    logError("wipay_return_reconcile_failed", error, {
      orderId,
      transactionId,
      status,
    });
    return safeRedirect(`${origin}/payment/failed?reason=db_error&order_id=${encodeURIComponent(orderId)}`);
  }

  if (!result.ok) {
    const reason = result.reason ?? "failed";
    if (reason === "overlap" && result.bookingId) {
      return safeRedirect(
        `${origin}/payment/failed?reason=overlap&bookingId=${encodeURIComponent(result.bookingId)}`,
      );
    }
    if (reason === "not_found") {
      return safeRedirect(
        `${origin}/payment/failed?reason=notfound&order_id=${encodeURIComponent(orderId)}`,
      );
    }
    if (reason === "bad_hash") {
      return safeRedirect(
        `${origin}/payment/failed?reason=bad_hash&order_id=${encodeURIComponent(orderId)}`,
      );
    }
    if (reason === "db_error") {
      return safeRedirect(
        `${origin}/payment/failed?reason=db_error&order_id=${encodeURIComponent(orderId)}`,
      );
    }
    if (reason === "failed_status") {
      return safeRedirect(
        `${origin}/payment/failed?reason=provider_error&order_id=${encodeURIComponent(orderId)}`,
      );
    }
    return safeRedirect(`${origin}/payment/failed?reason=payment_failed&order_id=${encodeURIComponent(orderId)}`);
  }

  return safeRedirect(
    `${origin}/payment/success?bookingId=${encodeURIComponent(result.bookingId ?? "")}`,
  );
}
