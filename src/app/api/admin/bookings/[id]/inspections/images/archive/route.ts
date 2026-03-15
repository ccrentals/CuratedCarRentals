import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import {
  archiveEligibleBookingVehicleInspectionImages,
  isBookingVehicleInspectionMissingTableError,
  loadBookingVehicleInspectionSummaries,
} from "@/lib/bookings/vehicleInspection";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ArchiveRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingInspectionImagesArchiveRouteDeps = {
  requireAdmin: typeof requireAdminRole;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  archiveImages: typeof archiveEligibleBookingVehicleInspectionImages;
  loadInspections: typeof loadBookingVehicleInspectionSummaries;
};

const DEFAULT_DEPS: AdminBookingInspectionImagesArchiveRouteDeps = {
  requireAdmin: requireAdminRole,
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  archiveImages: archiveEligibleBookingVehicleInspectionImages,
  loadInspections: loadBookingVehicleInspectionSummaries,
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImageIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length > 0);
}

export async function handleAdminBookingInspectionImagesArchivePost(
  request: Request,
  context: ArchiveRouteContext,
  deps: Partial<AdminBookingInspectionImagesArchiveRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await resolvedDeps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  const imageIds = normalizeImageIds(body?.imageIds ?? body?.image_ids);
  if (imageIds.some((entry) => !UUID_REGEX.test(entry))) {
    return NextResponse.json(
      { ok: false, error: "Image ids must be valid UUID values." },
      { status: 400 },
    );
  }

  try {
    const archiveRun = await resolvedDeps.archiveImages(id, {
      imageIds,
      archiveReason: normalizeText(body?.archiveReason ?? body?.archive_reason) || null,
      archiveSource: normalizeText(body?.archiveSource ?? body?.archive_source) || null,
      actorUserId: auth.actor.userId,
    });
    if (!archiveRun) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    const inspections = await resolvedDeps.loadInspections(id);
    if (!inspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      bookingId: archiveRun.bookingId,
      bookingPublicId: archiveRun.bookingPublicId,
      archiveRun,
      inspections,
    });
  } catch (error) {
    if (isBookingVehicleInspectionMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Booking inspection tables are not installed." },
        { status: 503 },
      );
    }

    logError("admin.booking-inspections.images.archive.POST", error, {
      bookingId: id,
      imageIds,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to archive inspection images." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: ArchiveRouteContext) {
  return handleAdminBookingInspectionImagesArchivePost(request, context);
}
