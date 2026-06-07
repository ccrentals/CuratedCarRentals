import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import {
  deleteUploadcareFile,
  extractUploadcareFileId,
  listUploadcareFiles,
} from "@/lib/uploads/uploadcare";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const RETENTION_DAYS = 30;
const ORPHAN_GRACE_DAYS = 7;
const MAX_CLEANUP_FILES = 200;

type ArchivedDocument = {
  id: string;
  storage_key: string;
};

type CleanupDeps = {
  listArchivedDocuments: () => Promise<ArchivedDocument[]>;
  deleteArchivedDocument: (id: string) => Promise<void>;
  listAuditedFileIds: () => Promise<string[]>;
  countActiveReferences: (fileId: string) => Promise<number>;
  listProviderFiles: typeof listUploadcareFiles;
  deleteProviderFile: typeof deleteUploadcareFile;
  writeAudit: typeof writeAuditLog;
};

const DEFAULT_DEPS: CleanupDeps = {
  listArchivedDocuments: async () => {
    const result = await dbQuery<ArchivedDocument>(
      `select id, storage_key
       from vehicle_documents
       where archived_at is not null
         and archived_at < now() - make_interval(days => $1::int)
       order by archived_at asc
       limit $2::int`,
      [RETENTION_DAYS, MAX_CLEANUP_FILES],
    );
    return result.rows;
  },
  deleteArchivedDocument: async (id) => {
    await dbQuery("delete from vehicle_documents where id = $1::uuid and archived_at is not null", [id]);
  },
  listAuditedFileIds: async () => {
    const result = await dbQuery<{ file_id: string }>(
      `select distinct details_json->>'fileId' as file_id
       from audit_logs
       where action = 'MEDIA_UPLOAD'
         and created_at < now() - make_interval(days => $1::int)
         and coalesce(details_json->>'fileId', '') <> ''
       order by file_id
       limit $2::int`,
      [ORPHAN_GRACE_DAYS, MAX_CLEANUP_FILES],
    );
    return result.rows.map((row: { file_id: string }) => row.file_id);
  },
  countActiveReferences: async (fileId) => {
    const result = await dbQuery<{ reference_count: number }>(
      `select (
         (select count(*) from booking_vehicle_inspection_images
          where archived_at is null and storage_key ilike $1)
         +
         (select count(*) from booking_private_files
          where storage_key ilike $1)
         +
         (select count(*) from vehicle_documents
          where archived_at is null and storage_key ilike $1)
         +
         (select count(*) from vehicles
          where deleted_at is null and image_urls_json::text ilike $1)
       )::int as reference_count`,
      [`%${fileId}%`],
    );
    return Number(result.rows[0]?.reference_count ?? 0);
  },
  listProviderFiles: listUploadcareFiles,
  deleteProviderFile: deleteUploadcareFile,
  writeAudit: writeAuditLog,
};

export async function handleArchiveFileCleanup(
  request: Request,
  deps: CleanupDeps = DEFAULT_DEPS,
) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [archivedDocuments, auditedFileIds, providerFiles] = await Promise.all([
      deps.listArchivedDocuments(),
      deps.listAuditedFileIds(),
      deps.listProviderFiles({ stored: true, limit: 1000, ordering: "datetime_uploaded" }),
    ]);
    const providerFileIds = new Set(
      providerFiles.filter((file) => !file.datetimeRemoved).map((file) => file.uuid),
    );
    const handledFileIds = new Set<string>();
    const summary = {
      archivedDocumentsDeleted: 0,
      orphanFilesDeleted: 0,
      referencedFilesPreserved: 0,
      providerFilesMissing: 0,
      failedCount: 0,
    };

    for (const document of archivedDocuments) {
      const fileId = extractUploadcareFileId(document.storage_key);
      try {
        if (fileId) {
          const referenceCount = await deps.countActiveReferences(fileId);
          if (referenceCount > 0) {
            summary.referencedFilesPreserved += 1;
            await deps.deleteArchivedDocument(document.id);
            summary.archivedDocumentsDeleted += 1;
            continue;
          }
          await deps.deleteProviderFile(fileId);
          handledFileIds.add(fileId);
        }
        await deps.deleteArchivedDocument(document.id);
        summary.archivedDocumentsDeleted += 1;
      } catch (error) {
        summary.failedCount += 1;
        logError("cron_archive_file_cleanup_document_failed", error, {
          documentId: document.id,
          fileId,
        });
      }
    }

    for (const rawFileId of auditedFileIds) {
      const fileId = extractUploadcareFileId(rawFileId);
      if (!fileId || handledFileIds.has(fileId)) continue;
      try {
        const referenceCount = await deps.countActiveReferences(fileId);
        if (referenceCount > 0) {
          summary.referencedFilesPreserved += 1;
          continue;
        }
        if (!providerFileIds.has(fileId)) {
          summary.providerFilesMissing += 1;
          continue;
        }
        await deps.deleteProviderFile(fileId);
        summary.orphanFilesDeleted += 1;
        await deps.writeAudit({
          action: "MEDIA_ORPHAN_DELETE",
          entityType: "uploadcare_file",
          entityId: fileId,
          details: { fileId, source: "archive-file-cleanup" },
        });
      } catch (error) {
        summary.failedCount += 1;
        logError("cron_archive_file_cleanup_orphan_failed", error, { fileId });
      }
    }

    await deps.writeAudit({
      action: "UPLOADCARE_CLEANUP_RUN",
      entityType: "cron_run",
      details: {
        event_type: "uploadcare_cleanup",
        retentionDays: RETENTION_DAYS,
        orphanGraceDays: ORPHAN_GRACE_DAYS,
        ...summary,
      },
    });

    return NextResponse.json({
      ok: true,
      olderThanDays: RETENTION_DAYS,
      orphanGraceDays: ORPHAN_GRACE_DAYS,
      ...summary,
    });
  } catch (error) {
    logError("cron_archive_file_cleanup_failed", error, {
      entity: "vehicle_documents",
      olderThanDays: RETENTION_DAYS,
    });

    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle documents table is not installed." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Failed to cleanup archived files." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleArchiveFileCleanup(request);
}
