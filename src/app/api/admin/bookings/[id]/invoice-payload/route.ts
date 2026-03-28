import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { getOrCreateInvoiceLedgerRow, hashInvoicePayload } from "@/lib/invoices/ledger";
import { loadAdminBookingInvoicePayload } from "@/lib/invoices/adminInvoicePayload";
import { logError } from "@/lib/log";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const invoice = await loadAdminBookingInvoicePayload(id);
  if (!invoice) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  try {
    await getOrCreateInvoiceLedgerRow({
      bookingId: invoice.bookingId,
      payloadHash: hashInvoicePayload(invoice.payload),
      source: "PDFMONKEY",
      templateId: process.env.PDFMONKEY_TEMPLATE_ID ?? null,
      createdByUserId: auth.actor.userId,
    });
  } catch (error) {
    logError("booking_invoice_payload_ledger_upsert_failed", error, {
      bookingId: invoice.bookingId,
      actorUserId: auth.actor.userId,
    });
  }

  return NextResponse.json({ payload: invoice.payload });
}
