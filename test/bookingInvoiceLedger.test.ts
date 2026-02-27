import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrCreateInvoiceLedgerRow,
  hashInvoicePayload,
  markInvoiceProviderInfo,
} from "@/lib/invoices/ledger";

type LedgerRow = {
  id: string;
  bookingId: string;
  payloadHash: string;
  providerDocumentId: string | null;
  providerStatus: string | null;
  downloadUrl: string | null;
  lastError: string | null;
};

test("invoice ledger: identical payload hash for same booking reuses single row", async () => {
  const rowsByKey = new Map<string, LedgerRow>();
  let rowCounter = 0;

  const query = async <T = unknown>(text: string, params: unknown[] = []) => {
    if (text.startsWith("insert into booking_invoice_documents")) {
      const bookingId = String(params[0]);
      const payloadHash = String(params[3]);
      const key = `${bookingId}:${payloadHash}`;
      if (!rowsByKey.has(key)) {
        rowCounter += 1;
        rowsByKey.set(key, {
          id: `row-${rowCounter}`,
          bookingId,
          payloadHash,
          providerDocumentId: null,
          providerStatus: null,
          downloadUrl: null,
          lastError: null,
        });
      }
      const row = rowsByKey.get(key)!;
      return {
        rows: [{ id: row.id, payload_hash: row.payloadHash }] as T[],
        rowCount: 1,
      };
    }

    if (text.startsWith("update booking_invoice_documents set provider_document_id")) {
      const bookingId = String(params[0]);
      const payloadHash = String(params[1]);
      const key = `${bookingId}:${payloadHash}`;
      const row = rowsByKey.get(key);
      if (row) {
        row.providerDocumentId = params[2] ? String(params[2]) : row.providerDocumentId;
        row.providerStatus = params[3] ? String(params[3]) : row.providerStatus;
        row.downloadUrl = params[4] ? String(params[4]) : row.downloadUrl;
        row.lastError = params[6] ? String(params[6]) : null;
      }
      return { rows: [] as T[], rowCount: row ? 1 : 0 };
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const bookingId = "123e4567-e89b-42d3-a456-426614174010";
  const payloadA = { booking: { id: bookingId }, total: 10000, lines: [{ code: "BASE", amount: 10000 }] };
  const payloadB = { booking: { id: bookingId }, total: 12000, lines: [{ code: "BASE", amount: 12000 }] };

  const firstHash = hashInvoicePayload(payloadA);
  const secondHash = hashInvoicePayload(payloadA);
  const thirdHash = hashInvoicePayload(payloadB);

  const first = await getOrCreateInvoiceLedgerRow(
    { bookingId, payloadHash: firstHash, source: "PDFMONKEY" },
    query,
  );
  const second = await getOrCreateInvoiceLedgerRow(
    { bookingId, payloadHash: secondHash, source: "PDFMONKEY" },
    query,
  );
  const third = await getOrCreateInvoiceLedgerRow(
    { bookingId, payloadHash: thirdHash, source: "PDFMONKEY" },
    query,
  );

  assert.equal(first.payloadHash, second.payloadHash);
  assert.notEqual(first.payloadHash, third.payloadHash);
  assert.equal(rowsByKey.size, 2);

  await markInvoiceProviderInfo(
    {
      bookingId,
      payloadHash: first.payloadHash,
      providerDocumentId: "pdf-doc-1",
      providerStatus: "SUCCESS",
      downloadUrl: "https://example.com/invoice.pdf",
    },
    query,
  );

  const firstRow = rowsByKey.get(`${bookingId}:${first.payloadHash}`);
  assert.equal(firstRow?.providerDocumentId, "pdf-doc-1");
  assert.equal(firstRow?.providerStatus, "SUCCESS");
  assert.equal(firstRow?.downloadUrl, "https://example.com/invoice.pdf");

  await markInvoiceProviderInfo(
    {
      bookingId,
      payloadHash: third.payloadHash,
      providerStatus: "FAILED",
      lastError: "provider timeout",
    },
    query,
  );

  const thirdRow = rowsByKey.get(`${bookingId}:${third.payloadHash}`);
  assert.equal(thirdRow?.providerStatus, "FAILED");
  assert.equal(thirdRow?.lastError, "provider timeout");
});

test("hashInvoicePayload: stable for object key ordering", () => {
  const first = hashInvoicePayload({ b: 2, a: 1, nested: { y: 2, x: 1 } });
  const second = hashInvoicePayload({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
  assert.equal(first, second);
});
