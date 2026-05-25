import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
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

    const deleted = await resolvedDeps.archiveImage(id, {
      imageId,
      inspectionId,
      inspectionType,
    });
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Inspection image not found." }, { status: 404 });
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
