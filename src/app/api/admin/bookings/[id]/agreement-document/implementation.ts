import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { loadBookingRentalAgreementPayload } from "@/lib/agreements/rentalAgreementPayload";
import { logError, redactText } from "@/lib/log";
import {
  generateRentalAgreementPdf,
  type RentalAgreementPdfProvider,
} from "@/lib/pdfmonkey";

export type AdminAgreementDocumentRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  loadAgreementPayload: typeof loadBookingRentalAgreementPayload;
  generateAgreement: typeof generateRentalAgreementPdf;
};

const DEFAULT_DEPS: AdminAgreementDocumentRouteDeps = {
  requireAdminAccess: requireOperationsAccess,
  loadAgreementPayload: loadBookingRentalAgreementPayload,
  generateAgreement: generateRentalAgreementPdf,
};

function parseRequestedProvider(value: string | null): RentalAgreementPdfProvider | null {
  if (value === "gotenberg" || value === "pdfmonkey") {
    return value;
  }
  return null;
}

function statusForProviderResult(providerStatus: string) {
  const normalized = providerStatus.trim().toUpperCase();
  if (normalized === "SUCCESS") return 200;
  if (normalized === "SKIPPED") return 503;
  if (normalized === "FAILED") return 502;
  return 202;
}

function sanitizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message).replace(/\s+/g, " ").slice(0, 400) || "Rental agreement generation failed.";
}

export async function handleAdminBookingAgreementDocumentGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  deps: Partial<AdminAgreementDocumentRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdminAccess();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedProviderRaw = url.searchParams.get("provider")?.trim().toLowerCase() ?? null;
  const requestedProvider = parseRequestedProvider(requestedProviderRaw);
  if (requestedProviderRaw && !requestedProvider) {
    return NextResponse.json(
      { ok: false, error: "Invalid rental agreement provider. Use gotenberg or pdfmonkey." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const agreement = await resolvedDeps.loadAgreementPayload(id);
  if (!agreement) {
    return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
  }

  try {
    const document = await resolvedDeps.generateAgreement(agreement.payload, {
      provider: requestedProvider ?? undefined,
    });

    return NextResponse.json(
      {
        ok: true,
        bookingId: agreement.bookingId,
        bookingPublicId: agreement.bookingPublicId,
        provider: document.provider,
        providerStatus: document.providerStatus,
        documentId: document.documentId ?? null,
        previewUrl: document.previewUrl ?? null,
        downloadUrl: document.downloadUrl ?? null,
      },
      { status: statusForProviderResult(document.providerStatus) },
    );
  } catch (error) {
    const provider = requestedProvider ?? "gotenberg";
    const safeError = sanitizeErrorMessage(error);
    logError("admin_internal_rental_agreement_generation_failed", error, {
      bookingId: agreement.bookingId,
      actorUserId: auth.actor.userId,
      provider,
    });
    return NextResponse.json(
      {
        ok: false,
        bookingId: agreement.bookingId,
        bookingPublicId: agreement.bookingPublicId,
        provider,
        providerStatus: "FAILED",
        error: safeError,
      },
      { status: 502 },
    );
  }
}

