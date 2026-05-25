import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { loadAdminBookingInvoicePayload } from "@/lib/invoices/adminInvoicePayload";
import { hashInvoicePayload } from "@/lib/invoices/ledger";
import { logError, redactText } from "@/lib/log";
import { generateInvoicePdf, type InvoicePdfProvider } from "@/lib/pdfmonkey";

export type AdminInvoiceDocumentRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  loadInvoicePayload: typeof loadAdminBookingInvoicePayload;
  generateInvoice: typeof generateInvoicePdf;
};

const DEFAULT_DEPS: AdminInvoiceDocumentRouteDeps = {
  requireAdminAccess: requireOperationsAccess,
  loadInvoicePayload: loadAdminBookingInvoicePayload,
  generateInvoice: generateInvoicePdf,
};

function parseRequestedProvider(value: string | null): InvoicePdfProvider | null {
  if (value === "gotenberg" || value === "pdfmonkey") {
    return value;
  }
  return null;
}

function statusForProviderResult(providerStatus: string) {
  const normalized = providerStatus.trim().toUpperCase();
  if (normalized === "SUCCESS") return 200;
  if (normalized === "SKIPPED") return 503;
  return 202;
}

function sanitizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message).replace(/\s+/g, " ").slice(0, 400) || "Invoice generation failed.";
}

export async function handleAdminBookingInvoiceDocumentGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  deps: Partial<AdminInvoiceDocumentRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdminAccess();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedProviderRaw = url.searchParams.get("provider")?.trim().toLowerCase() ?? null;
  const requestedProvider = parseRequestedProvider(requestedProviderRaw);
  if (requestedProviderRaw && !requestedProvider) {
    return NextResponse.json(
      { ok: false, error: "Invalid invoice provider. Use gotenberg or pdfmonkey." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const invoice = await resolvedDeps.loadInvoicePayload(id);
  if (!invoice) {
    return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
  }

  const payloadHash = hashInvoicePayload(invoice.payload);
  try {
    const document = await resolvedDeps.generateInvoice(invoice.payload, invoice.bookingId, {
      createdByUserId: auth.actor.userId,
      source: "ADMIN_INTERNAL_INVOICE",
      provider: requestedProvider,
    });

    return NextResponse.json(
      {
        ok: true,
        bookingId: invoice.bookingId,
        payloadHash,
        provider: document.provider,
        providerStatus: document.providerStatus,
        documentId: document.documentId ?? null,
        previewUrl: document.previewUrl ?? null,
        downloadUrl: document.downloadUrl ?? null,
      },
      { status: statusForProviderResult(document.providerStatus) },
    );
  } catch (error) {
    const provider = requestedProvider ?? "pdfmonkey";
    const safeError = sanitizeErrorMessage(error);
    logError("admin_internal_invoice_generation_failed", error, {
      bookingId: invoice.bookingId,
      actorUserId: auth.actor.userId,
      provider,
    });
    return NextResponse.json(
      {
        ok: false,
        bookingId: invoice.bookingId,
        payloadHash,
        provider,
        providerStatus: "FAILED",
        error: safeError,
      },
      { status: 502 },
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAdminBookingInvoiceDocumentGet(request, context);
}
