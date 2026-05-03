import { NextResponse } from "next/server";

import {
  bookingAccessForbiddenResponse,
  hasPublicBookingAccessForRequest,
} from "@/lib/bookings/publicAccess";
import { dbQuery } from "@/lib/db";
import { getPdfMonkeyDocumentUrls } from "@/lib/pdfmonkey";

type BookingAccessRow = {
  id: string;
  pricing_json: Record<string, unknown> | null;
};

type InvoiceDocumentRow = {
  provider_document_id: string | null;
  download_url: string | null;
};

function buildInvoiceFallbackUrl(request: Request, bookingId: string) {
  const url = new URL(`/bookings/${bookingId}/invoice`, request.url);
  return url;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const accessResult = await dbQuery<BookingAccessRow>(
    "select id, pricing_json from bookings where id = $1",
    [id],
  );
  const bookingAccess = accessResult.rows[0] ?? null;
  if (!bookingAccess) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const isAuthorized = await hasPublicBookingAccessForRequest(
    request,
    bookingAccess.id,
    bookingAccess.pricing_json,
  );
  if (!isAuthorized) {
    return bookingAccessForbiddenResponse();
  }

  let latestInvoiceDocument: InvoiceDocumentRow | null = null;
  try {
    const invoiceDocResult = await dbQuery<InvoiceDocumentRow>(
      "select provider_document_id, download_url from booking_invoice_documents where booking_id = $1 and (provider_document_id is not null or download_url is not null) order by generated_at desc limit 1",
      [id],
    );
    latestInvoiceDocument = invoiceDocResult.rows[0] ?? null;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "42P01") {
      throw error;
    }
  }

  const fallbackUrl = buildInvoiceFallbackUrl(request, id);
  if (!latestInvoiceDocument) {
    return NextResponse.redirect(fallbackUrl, 302);
  }

  let downloadUrl = latestInvoiceDocument.download_url ?? null;

  if (latestInvoiceDocument.provider_document_id) {
    const liveDocument = await getPdfMonkeyDocumentUrls(latestInvoiceDocument.provider_document_id);
    if (liveDocument?.downloadUrl) {
      downloadUrl = liveDocument.downloadUrl;
    }
  }

  if (!downloadUrl) {
    return NextResponse.redirect(fallbackUrl, 302);
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    return NextResponse.redirect(fallbackUrl, 302);
  }

  const pdfBuffer = await response.arrayBuffer();
  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="invoice-${id.slice(0, 8)}.pdf"`,
      "cache-control": "private, no-store, max-age=0",
      "x-frame-options": "SAMEORIGIN",
    },
  });
}
