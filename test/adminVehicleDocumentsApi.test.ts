import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleDocumentsGet,
  handleAdminVehicleDocumentsPost,
} from "@/app/api/admin/vehicles/[id]/documents/route";
import { handleAdminVehicleDocumentDownload } from "@/app/api/admin/vehicles/[id]/documents/[docId]/download/route";
import { handleAdminVehicleDocumentPatch } from "@/app/api/admin/vehicles/[id]/documents/[docId]/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";
const CHECKLIST_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "7f6b5a4a-84f9-4e57-8be4-7b4b2cbf76ad";

test("admin vehicle documents API: GET requires auth", async () => {
  const response = await handleAdminVehicleDocumentsGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listDocuments: async () => [],
      createDocument: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle documents API: POST requires auth", async () => {
  const response = await handleAdminVehicleDocumentsPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        folder: "Paperwork",
        title: "Registration",
        uploadcareFileId: FILE_ID,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listDocuments: async () => [],
      createDocument: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle documents API: POST stores opaque Uploadcare id", async () => {
  let capturedInput: Record<string, unknown> | null = null;

  const response = await handleAdminVehicleDocumentsPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        folder: "Paperwork",
        title: "Registration",
        document_type: "Registration Card",
        uploadcare_file_id: `https://ucarecdn.com/${FILE_ID}/`,
        storage_provider: "UPLOADCARE_FILE_ID",
        mime_type: "application/pdf",
        size_bytes: 12345,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      listDocuments: async () => [],
      createDocument: async (_vehicleId, input) => {
        capturedInput = input as unknown as Record<string, unknown>;
        return {
          id: DOC_ID,
          vehicle_id: VEHICLE_ID,
          maintenance_record_id: null,
          maintenance_title: null,
          checklist_item_id: null,
          checklist_label: null,
          folder: input.folder,
          document_type: input.documentType,
          title: input.title,
          label: null,
          storage_provider: input.storageProvider,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          file_size_bytes: input.fileSizeBytes,
          tags: input.tags,
          uploaded_by_user_id: "admin-user-id",
          created_at: "2026-02-22T10:00:00.000Z",
          archived_at: null,
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedInput);
  const saved = capturedInput as { storageKey?: unknown; storageProvider?: unknown };
  assert.equal(saved.storageKey, FILE_ID);
  assert.equal(saved.storageProvider, "UPLOADCARE_FILE_ID");

  const body = (await response.json()) as {
    ok: boolean;
    item: { storageProvider: string; storageKey?: string };
  };
  assert.equal(body.ok, true);
  assert.equal(body.item.storageProvider, "UPLOADCARE_FILE_ID");
  assert.equal("storageKey" in body.item, false);
});

test("admin vehicle documents API: POST forwards checklist link selection", async () => {
  let capturedInput: Record<string, unknown> | null = null;

  const response = await handleAdminVehicleDocumentsPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        folder: "Paperwork",
        title: "Insurance 2026",
        label: "Insurance 2026",
        document_type: "Insurance Certificate",
        uploadcare_file_id: FILE_ID,
        checklistItemId: CHECKLIST_ITEM_ID,
        storage_provider: "UPLOADCARE_FILE_ID",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      listDocuments: async () => [],
      createDocument: async (_vehicleId, input) => {
        capturedInput = input as unknown as Record<string, unknown>;
        return {
          id: DOC_ID,
          vehicle_id: VEHICLE_ID,
          maintenance_record_id: null,
          maintenance_title: null,
          checklist_item_id: CHECKLIST_ITEM_ID,
          checklist_label: "Insurance Certificate",
          folder: input.folder,
          document_type: input.documentType,
          title: input.title,
          label: input.label,
          storage_provider: input.storageProvider,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          file_size_bytes: input.fileSizeBytes,
          tags: input.tags,
          uploaded_by_user_id: "admin-user-id",
          created_at: "2026-02-22T10:00:00.000Z",
          archived_at: null,
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedInput?.checklistItemId, CHECKLIST_ITEM_ID);

  const body = (await response.json()) as {
    ok?: boolean;
    item?: { checklistItemId?: string | null; checklistItemLabel?: string | null };
  };
  assert.equal(body.ok, true);
  assert.equal(body.item?.checklistItemId, CHECKLIST_ITEM_ID);
  assert.equal(body.item?.checklistItemLabel, "Insurance Certificate");
});

test("admin vehicle documents API: POST rejects checklist folder mismatch", async () => {
  const response = await handleAdminVehicleDocumentsPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        folder: "Paperwork",
        title: "Insurance 2026",
        document_type: "Insurance Certificate",
        uploadcare_file_id: FILE_ID,
        checklistItemId: CHECKLIST_ITEM_ID,
        storage_provider: "UPLOADCARE_FILE_ID",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      listDocuments: async () => [],
      createDocument: async () => {
        throw new Error("CHECKLIST_ITEM_FOLDER_MISMATCH");
      },
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.match(String(body.error), /folder must match/i);
});

test("admin vehicle documents API: POST preserves signed delivery URL references", async () => {
  let capturedInput: Record<string, unknown> | null = null;
  const signedUrl = `https://ucarecdn.com/${FILE_ID}/-/preview/?token=test-token`;

  const response = await handleAdminVehicleDocumentsPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        folder: "Paperwork",
        title: "Signed URL document",
        document_type: "Registration Card",
        uploadcare_file_id: signedUrl,
        storage_provider: "UPLOADCARE_FILE_ID",
        mime_type: "image/png",
        size_bytes: 4567,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      listDocuments: async () => [],
      createDocument: async (_vehicleId, input) => {
        capturedInput = input as unknown as Record<string, unknown>;
        return {
          id: DOC_ID,
          vehicle_id: VEHICLE_ID,
          maintenance_record_id: null,
          maintenance_title: null,
          checklist_item_id: null,
          checklist_label: null,
          folder: input.folder,
          document_type: input.documentType,
          title: input.title,
          label: null,
          storage_provider: input.storageProvider,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          file_size_bytes: input.fileSizeBytes,
          tags: input.tags,
          uploaded_by_user_id: "admin-user-id",
          created_at: "2026-02-22T10:00:00.000Z",
          archived_at: null,
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedInput);
  const saved = capturedInput as { storageKey?: unknown; storageProvider?: unknown };
  assert.equal(saved.storageKey, signedUrl);
  assert.equal(saved.storageProvider, "UPLOADCARE_FILE_ID");
});

test("admin vehicle documents API: download endpoint requires auth", async () => {
  const response = await handleAdminVehicleDocumentDownload(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents/${DOC_ID}/download`),
    { params: Promise.resolve({ id: VEHICLE_ID, docId: DOC_ID }) },
    {
      getSession: async () => null,
      getDocument: async () => null,
    },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("admin vehicle documents API: download rejects html placeholder responses", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response("<!doctype html><html><body>Uploadcare CDN</body></html>", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    })) as typeof fetch;

  try {
    const response = await handleAdminVehicleDocumentDownload(
      new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents/${DOC_ID}/download`),
      { params: Promise.resolve({ id: VEHICLE_ID, docId: DOC_ID }) },
      {
        getSession: async () => ({
          userId: "admin-user-id",
          role: "ADMIN",
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        }),
        getDocument: async () => ({
          id: DOC_ID,
          title: "Document.png",
          storage_provider: "UPLOADCARE_FILE_ID",
          storage_key: `https://ucarecd.net/${FILE_ID}/`,
          mime_type: "image/png",
        }),
      },
    );

    assert.equal(response.status, 502);
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    assert.equal(payload.ok, false);
    assert.match(String(payload.error), /Unable to load file from storage/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin vehicle documents API: PATCH archives and relabels document", async () => {
  const response = await handleAdminVehicleDocumentPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/documents/${DOC_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        archived: true,
        label: "Archived invoice",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, docId: DOC_ID }) },
    {
      getSession: async () => ({
        userId: "admin-user-id",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      requireCsrfCheck: async () => true,
      patchDocument: async () => ({
        id: DOC_ID,
        vehicle_id: VEHICLE_ID,
        maintenance_record_id: null,
        folder: "Paperwork",
        document_type: "SERVICE_INVOICE",
        title: "Invoice",
        label: "Archived invoice",
        storage_provider: "UPLOADCARE_FILE_ID",
        mime_type: "application/pdf",
        size_bytes: 222,
        file_size_bytes: 222,
        tags: [],
        uploaded_by_user_id: "admin-user-id",
        created_at: "2026-02-22T10:00:00.000Z",
        archived_at: "2026-02-23T10:00:00.000Z",
      }),
      archiveDocument: async () => true,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok?: boolean; item?: { archivedAt?: string | null } };
  assert.equal(body.ok, true);
  assert.equal(typeof body.item?.archivedAt, "string");
});
