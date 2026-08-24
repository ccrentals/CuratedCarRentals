import { NextResponse } from "next/server";

import { processPendingPaymentInvoices } from "@/lib/payments/invoiceRetry";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processPendingPaymentInvoices(3);
  return NextResponse.json({ ok: true, ...result });
}
