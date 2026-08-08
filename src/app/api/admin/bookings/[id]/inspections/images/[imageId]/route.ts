import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { writeMediaAudit } from "@/lib/uploads/mediaAudit";
import {
  deleteUploadcareFile,
  extractUploadcareFileId,
  getUploadcareFileMetadata,
  UploadcareFileValidationError,
} from "@/lib/uploads/uploadcare";
import {
  deleteBunnyStorageObject,
  fetchBunnyStorageObject,
  getBunnyStorageConfig,
} from "@/lib/uploads/bunny";
import {
  BOOKING_VEHICLE_INSPECTION_TYPES,
  archiveBookingVehicleInspectionImage,
  isBookingVehicleInspectionMissingTableError,
  isPickupInspectionEditableForStatus,
  isReturnInspectionAvailableForStatus,
  isReturnInspectionEditableForStatus,
  loadBookingVehicleInspectionSummaries,
  type BookingVehicleInspectionType,
} from "@/lib/bookings/vehicleInspection";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ImageItemRouteContext = {
  params: Promise<{ id: string; imageId: string }>;
};

export type AdminBookingInspectionImageRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getBookingStatus: (bookingId: string) => Promise<string | null>;
  loadInspections: typeof loadBookingVehicleInspectionSummaries;
  archiveImage: typeof archiveBookingVehicleInspectionImage;
  getImage: (bookingId: string, imageId: string) => Promise<{
    storageProvider?: string | null;
    storageKey: string;
    mimeType: string | null;
    fileName: string | null;
  } | null>;
  getFileMetadata: typeof getUploadcareFileMetadata;
  deleteFile: typeof deleteUploadcareFile;
  countActiveFileReferences: (fileId: string) => Promise<number>;
  writeMediaAudit: typeof writeMediaAudit;
  fetchFile: typeof fetch;
};

const DEFAULT_DEPS: AdminBookingInspectionImageRouteDeps = {
  requireAdminAccess: requireOperationsAccess,
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getBookingStatus: async (bookingId) => {
    const result = await dbQuery<{ status: string }>(
      "select status from bookings where id = $1::uuid limit 1",
      [bookingId],
    );
    return result.rows[0]?.status ?? null;
  },
  loadInspections: loadBookingVehicleInspectionSummaries,
  archiveImage: archiveBookingVehicleInspectionImage,
  getImage: async (bookingId, imageId) => {
    const result = await dbQuery<{
      storage_key: string;
      storage_provider: string | null;
      mime_type: string | null;
      generated_file_name: string | null;
      original_file_name: string | null;
    }>(
      `select storage_key, storage_provider, mime_type, generated_file_name, original_file_name
       from booking_vehicle_inspection_images
       where id = $1::uuid
         and booking_id = $2::uuid
         and archived_at is null
       limit 1`,
      [imageId, bookingId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      storageProvider: row.storage_provider,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      fileName: row.generated_file_name ?? row.original_file_name,
    };
  },
  getFileMetadata: getUploadcareFileMetadata,
  deleteFile: deleteUploadcareFile,
  countActiveFileReferences: async (fileId) => {
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
          where image_urls_json::text ilike $1)
       )::int as reference_count`,
      [`%${fileId}%`],
    );
    return Number(result.rows[0]?.reference_count ?? 0);
  },
  writeMediaAudit,
  fetchFile: fetch,
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInspectionType(value: unknown): BookingVehicleInspectionType | null {
  const normalized = normalizeText(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_TYPES.find((entry) => entry === normalized) ?? null;
}

function isInspectionImageEditableForStatus(
  bookingStatus: string | null,
  inspectionType: BookingVehicleInspectionType,
) {
  if (inspectionType === "PICKUP") {
    return isPickupInspectionEditableForStatus(bookingStatus);
  }
  return isReturnInspectionEditableForStatus(bookingStatus);
}

function getInspectionImageLockMessage(
  bookingStatus: string | null,
  inspectionType: BookingVehicleInspectionType,
) {
  if (inspectionType === "PICKUP") {
    return "Pickup inspection images are locked after pickup is confirmed.";
  }
  if (!isReturnInspectionAvailableForStatus(bookingStatus)) {
    return "Return inspection images become available after pickup is confirmed.";
  }
  return "Return inspection images are locked after booking completion.";
}

export async function handleAdminBookingInspectionImageGet(
  _request: Request,
  context: ImageItemRouteContext,
  deps: Partial<AdminBookingInspectionImageRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdminAccess();
  if (!auth.ok) return auth.response;

  const { id, imageId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(imageId)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const image = await resolvedDeps.getImage(id, imageId);
    if (!image) {
      return NextResponse.json({ error: "Inspection image not found." }, { status: 404 });
    }

    const storageProvider = normalizeText(image.storageProvider).toUpperCase();
    if (storageProvider === "BUNNY_STORAGE") {
      const upstream = await fetchBunnyStorageObject(getBunnyStorageConfig("private"), image.storageKey);
      const headers = new Headers({
        "Cache-Control": "private, max-age=300",
        "Content-Type": upstream.headers.get("content-type") ?? image.mimeType ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      if (image.fileName) {
        headers.set("Content-Disposition", `inline; filename="${image.fileName.replace(/[\"\r\n]/g, "_")}"`);
      }
      return new Response(upstream.body, { status: 200, headers });
    }

    const fileId = extractUploadcareFileId(image.storageKey);
    if (!fileId) {
      return NextResponse.json({ error: "Invalid inspection image reference." }, { status: 400 });
    }

    const metadata = await resolvedDeps.getFileMetadata(fileId);
    if (!metadata.originalFileUrl) {
      return NextResponse.json({ error: "Inspection image delivery URL is unavailable." }, { status: 502 });
    }

    const upstream = await resolvedDeps.fetchFile(metadata.originalFileUrl, {
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Inspection image could not be loaded." }, { status: 502 });
    }

    const headers = new Headers({
      "Cache-Control": "private, max-age=300",
      "Content-Type":
        upstream.headers.get("content-type") ??
        image.mimeType ??
        metadata.mimeType ??
        "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (image.fileName) {
      headers.set(
        "Content-Disposition",
        `inline; filename="${image.fileName.replace(/["\r\n]/g, "_")}"`,
      );
    }

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof UploadcareFileValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("admin.booking-inspections.images.GET", error, {
      bookingId: id,
      imageId,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json({ error: "Failed to load inspection image." }, { status: 500 });
  }
}

export async function handleAdminBookingInspectionImageDelete(
  request: Request,
  context: ImageItemRouteContext,
  deps: Partial<AdminBookingInspectionImageRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdminAccess();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await resolvedDeps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id, imageId } = await context.params;
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(imageId)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const inspectionId = normalizeText(body?.inspectionId ?? body?.inspection_id);
  if (!UUID_REGEX.test(inspectionId)) {
    return NextResponse.json({ ok: false, error: "Inspection id is required." }, { status: 400 });
  }

  const inspectionType = normalizeInspectionType(body?.inspectionType ?? body?.inspection_type);
  if (!inspectionType) {
    return NextResponse.json(
      { ok: false, error: "Inspection type is required. Use PICKUP or RETURN." },
      { status: 400 },
    );
  }

  try {
    const bookingStatus = await resolvedDeps.getBookingStatus(id);
    if (!bookingStatus) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    if (!isInspectionImageEditableForStatus(bookingStatus, inspectionType)) {
      return NextResponse.json(
        { ok: false, error: getInspectionImageLockMessage(bookingStatus, inspectionType) },
        { status: 400 },
      );
    }

    const inspections = await resolvedDeps.loadInspections(id);
    if (!inspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }
    const summary = inspectionType === "PICKUP" ? inspections.pickup : inspections.returnInspection;
    if (!summary.inspectionId || summary.inspectionId !== inspectionId) {
      return NextResponse.json({ ok: false, error: "Inspection record not found." }, { status: 404 });
    }

    const image = await resolvedDeps.getImage(id, imageId);
    if (!image) {
      return NextResponse.json({ ok: false, error: "Inspection image not found." }, { status: 404 });
    }
    const storageProvider = normalizeText(image.storageProvider).toUpperCase();
    const fileId = extractUploadcareFileId(image.storageKey);

    const deleted = await resolvedDeps.archiveImage(id, {
      imageId,
      inspectionId,
      inspectionType,
    });
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Inspection image not found." }, { status: 404 });
    }

    let providerFileDeleted = false;
    let providerFileShared = false;
    let cleanupWarning: string | null = null;
    if (storageProvider === "BUNNY_STORAGE") {
      try {
        await deleteBunnyStorageObject(getBunnyStorageConfig("private"), image.storageKey);
        providerFileDeleted = true;
      } catch (error) {
        cleanupWarning =
          "The image was removed from this inspection, but permanent storage cleanup failed.";
        logError("admin.booking-inspections.images.bunny-delete", error, {
          bookingId: id,
          imageId,
          actorUserId: auth.actor.userId,
        });
      }
    } else if (fileId) {
      try {
        providerFileShared = (await resolvedDeps.countActiveFileReferences(fileId)) > 0;
        if (!providerFileShared) {
          await resolvedDeps.deleteFile(fileId);
          providerFileDeleted = true;
        }
      } catch (error) {
        cleanupWarning =
          "The image was removed from this inspection, but permanent storage cleanup failed.";
        logError("admin.booking-inspections.images.provider-delete", error, {
          bookingId: id,
          imageId,
          fileId,
          actorUserId: auth.actor.userId,
        });
      }
    }

    try {
      await resolvedDeps.writeMediaAudit({
        userId: auth.actor.userId,
        action: "MEDIA_REMOVE",
        entityType: "booking",
        entityId: id,
        fileId: storageProvider === "BUNNY_STORAGE" ? image.storageKey : fileId,
        context: `${inspectionType.toLowerCase()} inspection`,
        label: image.fileName,
        outcome: cleanupWarning
          ? "Removed; provider cleanup failed"
          : providerFileShared
            ? "Removed; shared provider file preserved"
            : providerFileDeleted
              ? storageProvider === "BUNNY_STORAGE"
                ? "Removed and deleted from Bunny Storage"
                : "Removed and deleted from Uploadcare"
              : "Removed",
        details: { inspectionId, imageId, storageProvider },
      });
      if (cleanupWarning || providerFileShared || providerFileDeleted) {
        await resolvedDeps.writeMediaAudit({
          userId: auth.actor.userId,
          action: cleanupWarning
            ? "MEDIA_CLEANUP_FAILED"
            : providerFileShared
              ? "MEDIA_SHARED_PRESERVE"
              : "MEDIA_PROVIDER_DELETE",
          entityType: "booking",
          entityId: id,
          fileId: storageProvider === "BUNNY_STORAGE" ? image.storageKey : fileId,
          context: `${inspectionType.toLowerCase()} inspection`,
          label: image.fileName,
          outcome: cleanupWarning ?? (providerFileShared ? "File remains referenced" : "Deleted"),
          details: { inspectionId, imageId, storageProvider },
        });
      }
    } catch (auditError) {
      logError("admin.booking-inspections.images.audit-delete", auditError, {
        bookingId: id,
        imageId,
        fileId,
      });
    }

    const nextInspections = await resolvedDeps.loadInspections(id);
    if (!nextInspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      bookingId: nextInspections.bookingId,
      bookingPublicId: nextInspections.bookingPublicId,
      inspections: nextInspections,
      deletedImageId: imageId,
      providerFileDeleted,
      providerFileShared,
      cleanupWarning,
    });
  } catch (error) {
    if (isBookingVehicleInspectionMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Booking inspection tables are not installed." },
        { status: 503 },
      );
    }
    logError("admin.booking-inspections.images.DELETE", error, {
      bookingId: id,
      imageId,
      inspectionId,
      inspectionType,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to delete inspection image." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: ImageItemRouteContext) {
  return handleAdminBookingInspectionImageDelete(request, context);
}

export async function GET(request: Request, context: ImageItemRouteContext) {
  return handleAdminBookingInspectionImageGet(request, context);
}
