import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { getFileStorageProvider } from "@/lib/env";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { writeMediaAudit } from "@/lib/uploads/mediaAudit";
import {
  BunnyStorageError,
  createBunnyBookingInspectionStorageKey,
  deleteBunnyStorageObject,
  getBunnyStorageConfig,
  uploadBunnyStorageObject,
} from "@/lib/uploads/bunny";
import {
  BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES,
  BOOKING_VEHICLE_INSPECTION_TYPES,
  createBookingVehicleInspectionImages,
  isBookingVehicleInspectionMissingTableError,
  isPickupInspectionEditableForStatus,
  isReturnInspectionAvailableForStatus,
  isReturnInspectionEditableForStatus,
  loadBookingVehicleInspectionSummaries,
  type BookingVehicleInspectionImageCategory,
  type BookingVehicleInspectionType,
} from "@/lib/bookings/vehicleInspection";
import { UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES } from "@/lib/uploads/uploadcare";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMAGE_COUNT = 20;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set<string>(UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES);

type Context = { params: Promise<{ id: string }> };
type UploadFile = File & { name: string; size: number; type: string };

function isUploadFile(value: FormDataEntryValue): value is UploadFile {
  return typeof value !== "string" && typeof value.name === "string" && typeof value.size === "number";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function inspectionType(value: unknown): BookingVehicleInspectionType | null {
  const normalized = text(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_TYPES.find((entry) => entry === normalized) ?? null;
}

function category(value: unknown): BookingVehicleInspectionImageCategory | null {
  const normalized = text(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES.find((entry) => entry === normalized) ?? null;
}

function isEditable(status: string, type: BookingVehicleInspectionType) {
  return type === "PICKUP"
    ? isPickupInspectionEditableForStatus(status)
    : isReturnInspectionEditableForStatus(status);
}

function lockedMessage(status: string, type: BookingVehicleInspectionType) {
  if (type === "PICKUP") return "Pickup inspection images are locked after pickup is confirmed.";
  if (!isReturnInspectionAvailableForStatus(status)) {
    return "Return inspection images become available after pickup is confirmed.";
  }
  return "Return inspection images are locked after booking completion.";
}

export async function POST(request: Request, context: Context) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  if (getFileStorageProvider() !== "bunny") {
    return NextResponse.json({ ok: false, error: "Private Bunny uploads are not active for this environment." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const csrfToken = form?.get("csrfToken");
  if (!(await requireCsrf(request, typeof csrfToken === "string" ? csrfToken : null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id: bookingId } = await context.params;
  const inspectionId = text(form?.get("inspectionId"));
  const type = inspectionType(form?.get("inspectionType"));
  const imageCategory = category(form?.get("category"));
  const entries = form?.getAll("files") ?? [];
  const files = entries.filter(isUploadFile);
  if (!UUID_REGEX.test(bookingId) || !UUID_REGEX.test(inspectionId) || !type || !imageCategory) {
    return NextResponse.json({ ok: false, error: "A valid booking, inspection type, category, and draft inspection are required." }, { status: 400 });
  }
  if (files.length === 0 || files.length !== entries.length || files.length > MAX_IMAGE_COUNT) {
    return NextResponse.json({ ok: false, error: `Select between 1 and ${MAX_IMAGE_COUNT} images.` }, { status: 400 });
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type.trim().toLowerCase()) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: "Each image must be a JPG, PNG, WebP, HEIC, or HEIF file no larger than 10 MB." }, { status: 400 });
    }
  }

  const storedKeys: string[] = [];
  try {
    const booking = await dbQuery<{ status: string }>("select status from bookings where id = $1::uuid limit 1", [bookingId]);
    const status = booking.rows[0]?.status;
    if (!status) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    if (!isEditable(status, type)) {
      return NextResponse.json({ ok: false, error: lockedMessage(status, type) }, { status: 400 });
    }
    const current = await loadBookingVehicleInspectionSummaries(bookingId);
    const summary = type === "PICKUP" ? current?.pickup : current?.returnInspection;
    if (!summary?.inspectionId || summary.inspectionId !== inspectionId) {
      return NextResponse.json({ ok: false, error: "Save the inspection as a draft before uploading images." }, { status: 400 });
    }

    const config = getBunnyStorageConfig("private");
    const uploaded = [];
    for (const file of files) {
      const storageKey = createBunnyBookingInspectionStorageKey({
        bookingId,
        inspectionType: type,
        category: imageCategory,
        fileName: file.name,
      });
      await uploadBunnyStorageObject(config, storageKey, file);
      storedKeys.push(storageKey);
      uploaded.push({
        storageProvider: "BUNNY_STORAGE",
        storageKey,
        originalFileName: file.name,
        mimeType: file.type.trim().toLowerCase(),
        sizeBytes: file.size,
      });
    }
    const createdImages = await createBookingVehicleInspectionImages(bookingId, {
      inspectionId,
      inspectionType: type,
      category: imageCategory,
      files: uploaded,
      uploadedByUserId: auth.actor.userId,
    });
    if (createdImages.length !== uploaded.length) throw new BunnyStorageError("Unable to save inspection images.", 500);

    for (const [index, image] of createdImages.entries()) {
      try {
        await writeMediaAudit({
          userId: auth.actor.userId,
          action: "MEDIA_UPLOAD",
          entityType: "booking",
          entityId: bookingId,
          fileId: storedKeys[index],
          context: `${type.toLowerCase()} inspection`,
          label: files[index]?.name ?? null,
          outcome: "Saved privately to Bunny Storage",
          details: { inspectionId, category: imageCategory, imageId: image.id, storageProvider: "BUNNY_STORAGE" },
        });
      } catch (auditError) {
        logError("admin.booking-inspections.private-upload.audit", auditError, { bookingId, inspectionId });
      }
    }
    const inspections = await loadBookingVehicleInspectionSummaries(bookingId);
    return NextResponse.json({ ok: true, bookingId, inspections, createdImages });
  } catch (error) {
    if (storedKeys.length > 0) {
      try {
        const config = getBunnyStorageConfig("private");
        await Promise.allSettled(storedKeys.map((key) => deleteBunnyStorageObject(config, key)));
      } catch {
        // Preserve the main operation failure; cleanup is best effort.
      }
    }
    if (error instanceof BunnyStorageError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (isBookingVehicleInspectionMissingTableError(error)) {
      return NextResponse.json({ ok: false, error: "Booking inspection tables are not installed." }, { status: 503 });
    }
    logError("admin.booking-inspections.private-upload.POST", error, { bookingId, inspectionId, actorUserId: auth.actor.userId });
    return NextResponse.json({ ok: false, error: "Failed to save inspection images." }, { status: 500 });
  }
}
