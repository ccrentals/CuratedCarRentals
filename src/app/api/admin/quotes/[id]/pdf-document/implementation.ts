import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { logError, redactText } from "@/lib/log";
import {
  generateQuotePdfDocument,
  loadQuotePdfPayload,
  type QuotePdfProvider,
} from "@/lib/quotes/quotePdf";
import { isQuoteOpsMissingTableError } from "@/lib/quotes/quoteOps";

export type AdminQuoteDocumentRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  loadQuotePayload: typeof loadQuotePdfPayload;
  generateQuoteDocument: typeof generateQuotePdfDocument;
};

const DEFAULT_DEPS: AdminQuoteDocumentRouteDeps = {
  requireAdminAccess: requireOperationsAccess,
  loadQuotePayload: loadQuotePdfPayload,
  generateQuoteDocument: generateQuotePdfDocument,
};

function parseRequestedProvider(value: string | null): QuotePdfProvider | null {
  if (value === "native" || value === "pdfmonkey") {
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
  return redactText(message).replace(/\s+/g, " ").slice(0, 400) || "Quote PDF generation failed.";
}

export async function handleAdminQuoteDocumentGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  deps: Partial<AdminQuoteDocumentRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdminAccess();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedProviderRaw = url.searchParams.get("provider")?.trim().toLowerCase() ?? null;
  const requestedProvider = parseRequestedProvider(requestedProviderRaw);
  if (requestedProviderRaw && !requestedProvider) {
    return NextResponse.json(
      { ok: false, error: "Invalid quote provider. Use native or pdfmonkey." },
      { status: 400 },
    );
  }

  const { id } = await params;

  try {
    const quote = await resolvedDeps.loadQuotePayload(id);
    if (!quote) {
      return NextResponse.json({ ok: false, error: "Quote not found" }, { status: 404 });
    }

    const document = await resolvedDeps.generateQuoteDocument(quote, {
      provider: requestedProvider ?? undefined,
    });

    return NextResponse.json(
      {
        ok: true,
        quoteId: quote.quoteId,
        quotePublicId: quote.quotePublicId,
        provider: document.provider,
        providerStatus: document.providerStatus,
        documentId: document.documentId ?? null,
        previewUrl: document.previewUrl ?? null,
        downloadUrl: document.downloadUrl ?? null,
      },
      { status: statusForProviderResult(document.providerStatus) },
    );
  } catch (error) {
    if (isQuoteOpsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Quotes tables are not installed. Apply schema.sql changes." },
        { status: 503 },
      );
    }

    const provider = requestedProvider ?? "native";
    const safeError = sanitizeErrorMessage(error);
    logError("admin_internal_quote_pdf_generation_failed", error, {
      quoteId: id,
      actorUserId: auth.actor.userId,
      provider,
    });
    return NextResponse.json(
      {
        ok: false,
        quoteId: id,
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
  return handleAdminQuoteDocumentGet(request, context);
}
