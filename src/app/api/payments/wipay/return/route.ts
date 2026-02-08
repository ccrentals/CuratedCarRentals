import { NextResponse } from "next/server";

import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";

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

  const result = await reconcileWiPayPayment({
    orderId,
    transactionId,
    status,
    message,
    total,
    currency,
    hash,
    source: "return",
  });

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
    return safeRedirect(`${origin}/payment/failed?order_id=${encodeURIComponent(orderId)}`);
  }

  return safeRedirect(
    `${origin}/payment/success?bookingId=${encodeURIComponent(result.bookingId ?? "")}`,
  );
}
