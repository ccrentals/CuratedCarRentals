import { NextResponse } from "next/server";

import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { logError } from "@/lib/log";
import { getCanonicalSiteUrl } from "@/lib/wipay";

function buildRedirect(pathname: string, searchParams: Record<string, string | undefined> = {}) {
  const target = new URL(pathname, getCanonicalSiteUrl());
  for (const [key, value] of Object.entries(searchParams)) {
    if (value) {
      target.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(target);
}

function pickFromUrl(url: URL, keys: string[]) {
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function parseBodyFields(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return {};

    const read = (keys: string[]) => {
      for (const key of keys) {
        const raw = form.get(key);
        if (typeof raw === "string" && raw.trim()) return raw.trim();
      }
      return "";
    };

    return {
      status: read(["status"]),
      message: read(["message", "msg"]),
      transactionId: read(["transaction_id", "transactionId", "transaction"]),
      orderId: read(["order_id", "orderId", "order"]),
      total: read(["total"]),
      currency: read(["currency"]),
      hash: read(["hash"]),
    };
  }

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return {};

    const read = (keys: string[]) => {
      for (const key of keys) {
        const raw = body[key];
        if (typeof raw === "string" && raw.trim()) return raw.trim();
        if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
      }
      return "";
    };

    return {
      status: read(["status"]),
      message: read(["message", "msg"]),
      transactionId: read(["transaction_id", "transactionId", "transaction"]),
      orderId: read(["order_id", "orderId", "order"]),
      total: read(["total"]),
      currency: read(["currency"]),
      hash: read(["hash"]),
    };
  }

  return {};
}

export async function handleWiPayReturn(request: Request) {
  let url: URL;
  try {
    getCanonicalSiteUrl();
    url = new URL(request.url);
  } catch (error) {
    logError("wipay_return_site_url_invalid", error);
    return new Response("Payment callback misconfigured.", { status: 500 });
  }

  const bodyFields = request.method === "GET" ? {} : await parseBodyFields(request);
  const status = bodyFields.status || pickFromUrl(url, ["status"]);
  const message = bodyFields.message || pickFromUrl(url, ["message", "msg"]);
  const transactionId =
    bodyFields.transactionId || pickFromUrl(url, ["transaction_id", "transactionId", "transaction"]);
  const orderId = bodyFields.orderId || pickFromUrl(url, ["order_id", "orderId", "order"]);
  const total = bodyFields.total || pickFromUrl(url, ["total"]);
  const currency = bodyFields.currency || pickFromUrl(url, ["currency"]);
  const hash = bodyFields.hash || pickFromUrl(url, ["hash"]);

  if (!orderId) {
    return buildRedirect("/payment/failed", { reason: "notfound" });
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
    return buildRedirect("/payment/failed", {
      reason: "db_error",
      order_id: orderId,
    });
  }

  if (!result.ok) {
    const reason = result.reason ?? "failed";
    if (reason === "overlap" && result.bookingId) {
      return buildRedirect("/payment/failed", {
        reason: "overlap",
        bookingId: result.bookingId,
      });
    }
    if (reason === "not_found") {
      return buildRedirect("/payment/failed", {
        reason: "notfound",
        order_id: orderId,
      });
    }
    if (reason === "bad_hash") {
      return buildRedirect("/payment/failed", {
        reason: "bad_hash",
        order_id: orderId,
      });
    }
    if (reason === "db_error") {
      return buildRedirect("/payment/failed", {
        reason: "db_error",
        order_id: orderId,
      });
    }
    if (reason === "failed_status") {
      return buildRedirect("/payment/failed", {
        reason: "provider_error",
        order_id: orderId,
      });
    }
    return buildRedirect("/payment/failed", {
      reason: "payment_failed",
      order_id: orderId,
    });
  }

  return buildRedirect("/payment/success", {
    bookingId: result.bookingId ?? "",
  });
}

export async function GET(request: Request) {
  return handleWiPayReturn(request);
}

export async function POST(request: Request) {
  return handleWiPayReturn(request);
}
