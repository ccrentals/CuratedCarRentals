import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ImageRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingInspectionImagesRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getBookingStatus: (bookingId: string) => Promise<string | null>;
  loadInspections: typeof loadBookingVehicleInspectionSummaries;
  createImages: typeof createBookingVehicleInspectionImages;
};

const DEFAULT_DEPS: AdminBookingInspectionImagesRouteDeps = {
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
  createImages: createBookingVehicleInspectionImages,
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInspectionType(value: unknown): BookingVehicleInspectionType | null {
  const normalized = normalizeText(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_TYPES.find((entry) => entry === normalized) ?? null;
}

function normalizeImageCategory(value: unknown): BookingVehicleInspectionImageCategory | null {
  const normalized = normalizeText(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES.find((entry) => entry === normalized) ?? null;
}

function normalizeNullableText(value: unknown, max = 255) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function normalizeNullableInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizeFiles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const objectEntry = entry as Record<string, unknown>;
      const storageKey = normalizeText(
        objectEntry.storageKey ??
          objectEntry.storage_key ??
          objectEntry.uploadcareFileId ??
          objectEntry.uploadcare_file_id ??
          objectEntry.fileId ??
          objectEntry.cdnUrl ??
          objectEntry.url,
      );
      if (!storageKey) return null;
      return {
        storageProvider:
          normalizeText(objectEntry.storageProvider ?? objectEntry.storage_provider).toUpperCase() ||
          "UPLOADCARE_FILE_ID",
        storageKey,
        originalFileName: normalizeNullableText(
          objectEntry.originalFileName ?? objectEntry.original_file_name,
          255,
        ),
        mimeType: normalizeNullableText(objectEntry.mimeType ?? objectEntry.mime_type, 120),
        sizeBytes: normalizeNullableInt(objectEntry.sizeBytes ?? objectEntry.size_bytes),
        label: normalizeNullableText(objectEntry.label, 140),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
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

export async function handleAdminBookingInspectionImagesPost(
  request: Request,
  context: ImageRouteContext,
  deps: Partial<AdminBookingInspectionImagesRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdminAccess();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await resolvedDeps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
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

  const category = normalizeImageCategory(body?.category);
  if (!category) {
    return NextResponse.json(
      { ok: false, error: "Image category is required." },
      { status: 400 },
    );
  }

  const files = normalizeFiles(body?.files);
  if (files.length < 1) {
    return NextResponse.json(
      { ok: false, error: "Upload at least one image first." },
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
      return NextResponse.json(
        { ok: false, error: "Save the inspection as a draft before uploading images." },
        { status: 400 },
      );
    }

    const createdImages = await resolvedDeps.createImages(id, {
      inspectionId,
      inspectionType,
      category,
      files,
      uploadedByUserId: auth.actor.userId,
    });
    const nextInspections = await resolvedDeps.loadInspections(id);
    if (!nextInspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      bookingId: nextInspections.bookingId,
      bookingPublicId: nextInspections.bookingPublicId,
      inspections: nextInspections,
      createdImages,
    });
  } catch (error) {
    if (isBookingVehicleInspectionMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Booking inspection tables are not installed." },
        { status: 503 },
      );
    }

    const message = String((error as Error | null)?.message ?? "");
    if (message === "UNSUPPORTED_IMAGE_STORAGE_PROVIDER") {
      return NextResponse.json(
        { ok: false, error: "Unsupported inspection image storage provider." },
        { status: 400 },
      );
    }
    if (message === "INVALID_IMAGE_STORAGE_REFERENCE") {
      return NextResponse.json(
        { ok: false, error: "Invalid upload reference. Upload the image again." },
        { status: 400 },
      );
    }

    logError("admin.booking-inspections.images.POST", error, {
      bookingId: id,
      inspectionId,
      inspectionType,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to save inspection images." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: ImageRouteContext) {
  return handleAdminBookingInspectionImagesPost(request, context);
}
