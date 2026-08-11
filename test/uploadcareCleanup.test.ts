import assert from "node:assert/strict";
import test from "node:test";

import { handleArchiveFileCleanup } from "@/app/api/cron/archive-file-cleanup/implementation";

const FILE_A = "11111111-1111-4111-8111-111111111111";
const FILE_B = "22222222-2222-4222-8222-222222222222";

function request(secret = "test-secret") {
  return new Request("http://localhost/api/cron/archive-file-cleanup", {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
}

test("Uploadcare cleanup deletes old archived documents and audited orphans", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  const deletedProviderFiles: string[] = [];
  const deletedDocuments: string[] = [];
  const auditActions: string[] = [];

  try {
    const response = await handleArchiveFileCleanup(request(), {
      listArchivedDocuments: async () => [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", storage_key: FILE_A },
      ],
      deleteArchivedDocument: async (id) => {
        deletedDocuments.push(id);
      },
      listAuditedFileIds: async () => [FILE_B],
      countActiveReferences: async () => 0,
      listProviderFiles: async () => [
        {
          uuid: FILE_A,
          datetimeUploaded: "2026-01-01T00:00:00Z",
          datetimeStored: "2026-01-01T00:00:00Z",
          datetimeRemoved: null,
          originalFilename: "a.jpg",
        },
        {
          uuid: FILE_B,
          datetimeUploaded: "2026-01-01T00:00:00Z",
          datetimeStored: "2026-01-01T00:00:00Z",
          datetimeRemoved: null,
          originalFilename: "b.jpg",
        },
      ],
      deleteProviderFile: async (fileId) => {
        deletedProviderFiles.push(fileId);
        return { fileId, alreadyDeleted: false };
      },
      writeAudit: async (input) => {
        auditActions.push(input.action);
      },
    });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.archivedDocumentsDeleted, 1);
    assert.equal(body.orphanFilesDeleted, 1);
    assert.deepEqual(deletedProviderFiles, [FILE_A, FILE_B]);
    assert.deepEqual(deletedDocuments, ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    assert.deepEqual(auditActions, ["MEDIA_ORPHAN_DELETE", "UPLOADCARE_CLEANUP_RUN"]);
  } finally {
    process.env.CRON_SECRET = previousSecret;
  }
});

test("Uploadcare cleanup preserves referenced files", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  let providerDeletes = 0;
  const deletedDocuments: string[] = [];

  try {
    const response = await handleArchiveFileCleanup(request(), {
      listArchivedDocuments: async () => [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", storage_key: FILE_A },
      ],
      deleteArchivedDocument: async (id) => {
        deletedDocuments.push(id);
      },
      listAuditedFileIds: async () => [FILE_A],
      countActiveReferences: async () => 2,
      listProviderFiles: async () => [
        {
          uuid: FILE_A,
          datetimeUploaded: "2026-01-01T00:00:00Z",
          datetimeStored: "2026-01-01T00:00:00Z",
          datetimeRemoved: null,
          originalFilename: "a.jpg",
        },
      ],
      deleteProviderFile: async (fileId) => {
        providerDeletes += 1;
        return { fileId, alreadyDeleted: false };
      },
      writeAudit: async () => undefined,
    });
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.referencedFilesPreserved, 2);
    assert.equal(body.archivedDocumentsDeleted, 1);
    assert.equal(providerDeletes, 0);
    assert.deepEqual(deletedDocuments, ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  } finally {
    process.env.CRON_SECRET = previousSecret;
  }
});
