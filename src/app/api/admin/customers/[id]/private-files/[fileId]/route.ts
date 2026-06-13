import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { parseSafePrivateBookingImageDataUrl } from "@/lib/bookings/privateFiles";
import {
  CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE,
  customerPrivateFileName,
  resolveCustomerPrivateFileMimeType,
  type CustomerPrivateFileRow,
} from "@/lib/customers/privateFiles";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import {
  buildUploadcareCdnUrl,
  deleteUploadcareFile,
  extractUploadcareDeliveryUrl,
  extractUploadcareFileId,
  getUploadcareFileMetadata,
} from "@/lib/uploads/uploadcare";
import { writeMediaAudit } from "@/lib/uploads/mediaAudit";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function loadFile(customerId: string, fileId: string) {
  const result = await dbQuery<CustomerPrivateFileRow>(
    `select
       bpf.id,
       bpf.customer_id,
       bpf.booking_id,
       b.public_id as booking_public_id,
       bpf.document_type,
       bpf.storage_provider,
       bpf.storage_key,
       bpf.original_file_name,
       bpf.mime_type,
       bpf.byte_size,
       bpf.metadata_json,
       bpf.created_by_user_id,
       bpf.created_at
     from booking_private_files bpf
     left join bookings b on b.id = bpf.booking_id
     where bpf.id = $1::uuid
       and bpf.customer_id = $2::uuid
       and bpf.document_type = $3
     limit 1`,
    [fileId, customerId, CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE],
  );
  return result.rows[0] ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const { id: customerId, fileId } = await params;
  if (!UUID_REGEX.test(customerId) || !UUID_REGEX.test(fileId)) {
    return jsonNoStore({ ok: false, error: "Invalid file request." }, 400);
  }

  try {
    const file = await loadFile(customerId, fileId);
    if (!file) {
      return jsonNoStore({ ok: false, error: "File not found." }, 404);
    }
    if (file.storage_provider.trim().toUpperCase() === "DATA_URL") {
      const parsed = parseSafePrivateBookingImageDataUrl(file.storage_key);
      if (!parsed) {
        return jsonNoStore({ ok: false, error: "Unable to load a safe image." }, 500);
      }
      return new NextResponse(parsed.bytes, {
        status: 200,
        headers: {
          "content-type": parsed.mimeType,
          "cache-control": "private, max-age=0, no-store",
          "content-disposition": `inline; filename="${customerPrivateFileName({
            ...file,
            mime_type: parsed.mimeType,
          })}"`,
          "x-content-type-options": "nosniff",
        },
      });
    }
    const uploadcareFileId = extractUploadcareFileId(file.storage_key);
    if (!uploadcareFileId) {
      return jsonNoStore({ ok: false, error: "Unsupported storage reference." }, 500);
    }

    const candidateUrls = new Set<string>();
    const storedDeliveryUrl = extractUploadcareDeliveryUrl(file.storage_key);
    if (storedDeliveryUrl) candidateUrls.add(storedDeliveryUrl);

    try {
      const metadata = await getUploadcareFileMetadata(uploadcareFileId);
      if (metadata.originalFileUrl) candidateUrls.add(metadata.originalFileUrl);
    } catch (error) {
      logError("api.admin.customers.private-files.file.metadata", error, {
        customerId,
        fileId,
        uploadcareFileId,
        userId: auth.actor.userId,
      });
    }

    candidateUrls.add(buildUploadcareCdnUrl(uploadcareFileId));

    let upstream: Response | null = null;
    for (const candidateUrl of candidateUrls) {
      const response = await fetch(candidateUrl, { cache: "no-store" });
      if (response.ok && response.body) {
        upstream = response;
        break;
      }
    }
    if (!upstream) {
      return jsonNoStore({ ok: false, error: "Unable to load file from storage." }, 502);
    }
    const mimeType = resolveCustomerPrivateFileMimeType(
      file.mime_type,
      upstream.headers.get("content-type"),
    );
    if (!mimeType) {
      return jsonNoStore({ ok: false, error: "Unable to load a safe image." }, 502);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": mimeType,
        "cache-control": "private, max-age=0, no-store",
        "content-disposition": `inline; filename="${customerPrivateFileName(file)}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logError("api.admin.customers.private-files.file.GET", error, {
      customerId,
      fileId,
      userId: auth.actor.userId,
    });
    return jsonNoStore({ ok: false, error: "Failed to load customer ID image." }, 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await requireCsrf(request, typeof body?.csrfToken === "string" ? body.csrfToken : null))) {
    return jsonNoStore({ ok: false, error: "Invalid CSRF token." }, 403);
  }

  const { id: customerId, fileId } = await params;
  if (!UUID_REGEX.test(customerId) || !UUID_REGEX.test(fileId)) {
    return jsonNoStore({ ok: false, error: "Invalid file request." }, 400);
  }

  try {
    const file = await loadFile(customerId, fileId);
    if (!file) {
      return jsonNoStore({ ok: false, error: "File not found." }, 404);
    }

    const deleteResult = await dbQuery<{ id: string }>(
      `delete from booking_private_files
       where id = $1::uuid
         and customer_id = $2::uuid
         and document_type = $3
       returning id`,
      [fileId, customerId, CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE],
    );
    if (!deleteResult.rows[0]) {
      return jsonNoStore({ ok: false, error: "File not found." }, 404);
    }

    const uploadcareFileId = extractUploadcareFileId(file.storage_key);
    let providerFileDeleted = false;
    let providerFileShared = false;
    let cleanupWarning: string | null = null;
    if (uploadcareFileId) {
      try {
        const referenceResult = await dbQuery<{ reference_count: number }>(
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
              where image_urls_json::text ilike $1)
           )::int as reference_count`,
          [`%${uploadcareFileId}%`],
        );
        providerFileShared = Number(referenceResult.rows[0]?.reference_count ?? 0) > 0;
        if (!providerFileShared) {
          await deleteUploadcareFile(uploadcareFileId);
          providerFileDeleted = true;
        }
      } catch (error) {
        cleanupWarning =
          "The image was removed from the customer, but permanent storage cleanup failed.";
        logError("api.admin.customers.private-files.file.provider-delete", error, {
          customerId,
          fileId,
          uploadcareFileId,
          userId: auth.actor.userId,
        });
      }
    }

    try {
      await writeMediaAudit({
        userId: auth.actor.userId,
        action: "MEDIA_REMOVE",
        entityType: "customer",
        entityId: customerId,
        fileId: uploadcareFileId,
        context: "customer legal identification",
        label: file.original_file_name,
        outcome: cleanupWarning
          ? "Removed; provider cleanup failed"
          : providerFileShared
            ? "Removed; shared provider file preserved"
            : providerFileDeleted
              ? "Removed and deleted from Uploadcare"
              : "Removed",
        details: { privateFileId: fileId },
      });
      if (cleanupWarning || providerFileShared || providerFileDeleted) {
        await writeMediaAudit({
          userId: auth.actor.userId,
          action: cleanupWarning
            ? "MEDIA_CLEANUP_FAILED"
            : providerFileShared
              ? "MEDIA_SHARED_PRESERVE"
              : "MEDIA_PROVIDER_DELETE",
          entityType: "customer",
          entityId: customerId,
          fileId: uploadcareFileId,
          context: "customer legal identification",
          label: file.original_file_name,
          outcome: cleanupWarning ?? (providerFileShared ? "File remains referenced" : "Deleted"),
          details: { privateFileId: fileId },
        });
      }
    } catch (auditError) {
      logError("api.admin.customers.private-files.file.DELETE.audit", auditError, {
        customerId,
        fileId,
      });
    }

    return jsonNoStore(
      {
        ok: true,
        deletedFileId: fileId,
        providerFileDeleted,
        providerFileShared,
        cleanupWarning,
      },
      200,
    );
  } catch (error) {
    logError("api.admin.customers.private-files.file.DELETE", error, {
      customerId,
      fileId,
      userId: auth.actor.userId,
    });
    return jsonNoStore({ ok: false, error: "Failed to remove customer ID image." }, 500);
  }
}
