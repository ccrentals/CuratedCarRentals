import { redactText } from "@/lib/log";

const PDFMONKEY_BASE_URL = "https://api.pdfmonkey.io/api/v1";

export type InvoicePaymentLine = {
  provider: string;
  status: string;
  amount: number;
  date: string;
};

export type InvoicePayloadInput = {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  dailyRate: number;
  deposit: number;
  total: number;
  paidToDate: number;
  balanceDue: number;
  payments: InvoicePaymentLine[];
};

type PdfMonkeyDocument = {
  id?: string;
  status?: string;
  download_url?: string | null;
  preview_url?: string | null;
  failure_cause?: string | null;
};

function getPdfMonkeyKey() {
  const key = process.env.PDFMONKEY_API_KEY;
  if (!key) return null;
  return key;
}

function getTemplateId() {
  const templateId = process.env.PDFMONKEY_TEMPLATE_ID;
  if (!templateId) return null;
  return templateId;
}

export function buildInvoicePayload(input: InvoicePayloadInput) {
  return {
    booking: {
      id: input.bookingId,
      reference: input.bookingId.slice(0, 8),
      status: input.bookingStatus,
      pickup_location: input.pickupLocation,
      start_date: input.startDate,
      end_date: input.endDate,
    },
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
    },
    vehicle: {
      make: input.vehicleMake,
      model: input.vehicleModel,
      year: input.vehicleYear,
      daily_rate: input.dailyRate,
    },
    charges: {
      total: input.total,
      deposit: input.deposit,
      paid_to_date: input.paidToDate,
      balance_due: input.balanceDue,
    },
    payments: input.payments,
    issued_at: new Date().toISOString(),
  };
}

async function createDocumentSync(payload: Record<string, unknown>, meta: Record<string, unknown>) {
  const apiKey = getPdfMonkeyKey();
  const templateId = getTemplateId();
  if (!apiKey || !templateId) {
    return null;
  }

  const response = await fetch(`${PDFMONKEY_BASE_URL}/documents/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document: {
        document_template_id: templateId,
        status: "pending",
        payload,
        meta,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const safe = redactText(text).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`PDFMonkey request failed: HTTP ${response.status}${safe ? `: ${safe}` : ""}`);
  }

  const data = (await response.json()) as {
    document?: PdfMonkeyDocument;
    document_card?: PdfMonkeyDocument;
  };

  return data.document_card ?? data.document ?? null;
}

async function fetchDocument(documentId: string) {
  const apiKey = getPdfMonkeyKey();
  if (!apiKey) return null;

  const response = await fetch(`${PDFMONKEY_BASE_URL}/documents/${documentId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { document?: PdfMonkeyDocument };
  return data.document ?? null;
}

export async function generateInvoicePdf(payload: Record<string, unknown>, bookingId: string) {
  const meta = {
    _filename: `invoice-${bookingId.slice(0, 8)}.pdf`,
    booking_id: bookingId,
  };

  const document = await createDocumentSync(payload, meta);
  if (!document) return null;

  if (document.status && document.status !== "success") {
    throw new Error(document.failure_cause ?? "PDFMonkey generation failed");
  }

  let downloadUrl = document.download_url ?? undefined;
  let previewUrl = document.preview_url ?? undefined;

  if (!downloadUrl && document.id) {
    const refreshed = await fetchDocument(document.id);
    downloadUrl = refreshed?.download_url ?? downloadUrl;
    previewUrl = refreshed?.preview_url ?? previewUrl;
  }

  return {
    downloadUrl,
    previewUrl,
    documentId: document.id,
  };
}

export async function downloadPdfBase64(downloadUrl: string) {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download PDF (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}
