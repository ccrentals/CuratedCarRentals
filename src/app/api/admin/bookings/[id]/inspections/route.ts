import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { hasRequiredAdminAccess } from "@/lib/auth/roles";
import { writeAuditLog } from "@/lib/audit";
import {
  BOOKING_VEHICLE_INSPECTION_RECORD_STATUSES,
  BOOKING_VEHICLE_INSPECTION_TYPES,
  correctBookingVehicleInspectionOdometer,
  formatBookingVehicleInspectionOdometer,
  isPickupInspectionEditableForStatus,
  isReturnInspectionAvailableForStatus,
  isReturnInspectionEditableForStatus,
  isBookingVehicleInspectionMissingTableError,
  loadBookingVehicleInspectionSummaries,
  processBookingVehicleInspectionIssues,
  syncVehicleOdometerFromInspectionCompletion,
  upsertBookingVehicleInspection,
  type BookingVehicleInspectionRecordStatus,
  type BookingVehicleInspectionType,
} from "@/lib/bookings/vehicleInspection";
import { dbQuery } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdminBookingInspectionRouteDeps = {
  requireStaff: typeof requireStaffOrAdminRole;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getBookingStatus: (bookingId: string) => Promise<string | null>;
  loadInspections: typeof loadBookingVehicleInspectionSummaries;
  processInspectionIssues: typeof processBookingVehicleInspectionIssues;
  saveInspection: typeof upsertBookingVehicleInspection;
  correctInspectionOdometer: typeof correctBookingVehicleInspectionOdometer;
  syncVehicleOdometer: typeof syncVehicleOdometerFromInspectionCompletion;
  writeAudit: typeof writeAuditLog;
};

const DEFAULT_DEPS: AdminBookingInspectionRouteDeps = {
  requireStaff: requireStaffOrAdminRole,
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getBookingStatus: async (bookingId) => {
    const result = await dbQuery<{ status: string }>(
      "select status from bookings where id = $1::uuid limit 1",
      [bookingId],
    );
    return result.rows[0]?.status ?? null;
  },
  loadInspections: loadBookingVehicleInspectionSummaries,
  processInspectionIssues: processBookingVehicleInspectionIssues,
  saveInspection: upsertBookingVehicleInspection,
  correctInspectionOdometer: correctBookingVehicleInspectionOdometer,
  syncVehicleOdometer: syncVehicleOdometerFromInspectionCompletion,
  writeAudit: writeAuditLog,
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown, maxLength = 255) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeInspectionType(value: unknown): BookingVehicleInspectionType | null {
  const normalized = normalizeText(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_TYPES.find((entry) => entry === normalized) ?? null;
}

function normalizeInspectionStatus(value: unknown): BookingVehicleInspectionRecordStatus | null {
  const normalized = normalizeText(value).toUpperCase();
  return BOOKING_VEHICLE_INSPECTION_RECORD_STATUSES.find((entry) => entry === normalized) ?? null;
}

function normalizeInspectionAction(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) return "UPSERT";
  if (normalized === "CORRECT_ODOMETER") return normalized;
  return null;
}

function normalizeNullableInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

function normalizeDamagePresent(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeOdometerUnit(value: unknown, odometerValue: number | null) {
  const normalized = normalizeNullableText(value, 16);
  if (normalized) return normalized.toUpperCase();
  return odometerValue === null ? null : "KM";
}

function normalizeNotes(value: unknown) {
  const normalized = normalizeNullableText(value, 4000);
  return normalized;
}

function normalizeCorrectionReason(value: unknown) {
  return normalizeNullableText(value, 1000);
}

function getInspectionLabel(inspectionType: BookingVehicleInspectionType) {
  return inspectionType === "PICKUP" ? "pickup" : "return";
}

function formatOdometerReading(value: number, unit: string | null | undefined) {
  const normalizedUnit = normalizeNullableText(unit, 16) ?? "KM";
  return `${value.toLocaleString()} ${normalizedUnit}`;
}

function mapInspectionPayload(summary: NonNullable<Awaited<ReturnType<typeof loadBookingVehicleInspectionSummaries>>>["pickup"]) {
  return {
    inspectionId: summary.inspectionId,
    inspectionType: summary.inspectionType,
    status: summary.recordStatus,
    displayStatus: summary.displayStatus,
    displayStatusLabel: summary.displayStatusLabel,
    odometerValue: summary.odometerValue,
    odometerUnit: summary.odometerUnit,
    fuelLevelEighths: summary.fuelLevelEighths,
    fuelLevelDisplay: summary.fuelLevelDisplay,
    damagePresent: summary.damagePresent,
    damageDisplay: summary.damageDisplay,
    notes: summary.notes,
    noteSnippet: summary.noteSnippet,
    imageCount: summary.imageCount,
    images: summary.images,
    recordedByUserId: summary.recordedByUserId,
    recordedByDisplay: summary.recordedByDisplay,
    recordedAt: summary.recordedAt,
    completedAt: summary.completedAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    hasOdometerCorrection: summary.hasOdometerCorrection,
    odometerCorrectedFromValue: summary.odometerCorrectedFromValue,
    odometerCorrectionReason: summary.odometerCorrectionReason,
    odometerCorrectedByUserId: summary.odometerCorrectedByUserId,
    odometerCorrectedByDisplay: summary.odometerCorrectedByDisplay,
    odometerCorrectedAt: summary.odometerCorrectedAt,
  };
}

function mapInspectionSet(
  inspections: NonNullable<Awaited<ReturnType<typeof loadBookingVehicleInspectionSummaries>>>,
) {
  return {
    vehicleOdometerValue: inspections.vehicleOdometerValue,
    vehicleOdometerUnit: inspections.vehicleOdometerUnit,
    pickup: mapInspectionPayload(inspections.pickup),
    returnInspection: mapInspectionPayload(inspections.returnInspection),
  };
}

export async function handleAdminBookingInspectionsGet(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
  deps: Partial<AdminBookingInspectionRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireStaff();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  try {
    const inspections = await resolvedDeps.loadInspections(id);
    if (!inspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      bookingId: inspections.bookingId,
      bookingPublicId: inspections.bookingPublicId,
      vehicleId: inspections.vehicleId,
      inspections: mapInspectionSet(inspections),
    });
  } catch (error) {
    if (isBookingVehicleInspectionMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Booking inspection tables are not installed." },
        { status: 503 },
      );
    }
    logError("admin.booking-inspections.GET", error, { bookingId: id });
    return NextResponse.json({ ok: false, error: "Failed to load booking inspections." }, { status: 500 });
  }
}

export async function handleAdminBookingInspectionsPut(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  deps: Partial<AdminBookingInspectionRouteDeps> = {},
) {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const auth = await resolvedDeps.requireStaff();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await resolvedDeps.requireCsrfCheck(request, (body?.csrfToken as string | null | undefined) ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid booking id" }, { status: 400 });
  }

  const inspectionType = normalizeInspectionType(body?.inspectionType ?? body?.inspection_type);
  if (!inspectionType) {
    return NextResponse.json(
      { ok: false, error: "Inspection type is required. Use PICKUP or RETURN." },
      { status: 400 },
    );
  }

  const action = normalizeInspectionAction(body?.action);
  if (!action) {
    return NextResponse.json(
      { ok: false, error: "Invalid inspection action." },
      { status: 400 },
    );
  }

  if (action === "CORRECT_ODOMETER") {
    if (!hasRequiredAdminAccess(auth.actor.role, "admin")) {
      return NextResponse.json(
        { ok: false, error: "Only admin users can correct inspection odometer values." },
        { status: 403 },
      );
    }

    const inspectionId = normalizeText(body?.inspectionId ?? body?.inspection_id);
    if (!UUID_REGEX.test(inspectionId)) {
      return NextResponse.json(
        { ok: false, error: "Inspection id is required for odometer correction." },
        { status: 400 },
      );
    }

    const correctedOdometerValue = normalizeNullableInt(
      body?.correctedOdometerValue ?? body?.corrected_odometer_value ?? body?.odometerValue,
    );
    if (correctedOdometerValue === null || correctedOdometerValue < 0) {
      return NextResponse.json(
        { ok: false, error: "Corrected odometer must be a non-negative whole number." },
        { status: 400 },
      );
    }

    const correctionReason = normalizeCorrectionReason(
      body?.correctionReason ?? body?.correction_reason ?? body?.reason,
    );
    if (!correctionReason) {
      return NextResponse.json(
        { ok: false, error: "Correction reason is required." },
        { status: 400 },
      );
    }

    try {
      const correction = await resolvedDeps.correctInspectionOdometer(id, {
        inspectionId,
        inspectionType,
        correctedOdometerValue,
        correctionReason,
        correctedByUserId: auth.actor.userId,
      });

      if (!correction.ok) {
        return NextResponse.json({ ok: false, error: correction.error }, { status: correction.status });
      }

      const inspections = await resolvedDeps.loadInspections(id);
      if (!inspections) {
        return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
      }

      const updatedSummary =
        inspectionType === "PICKUP" ? inspections.pickup : inspections.returnInspection;

      await resolvedDeps.writeAudit({
        userId: auth.actor.userId,
        action: "BOOKING_VEHICLE_INSPECTION_ODOMETER_CORRECTED",
        entityType: "booking",
        entityId: id,
        details: {
          bookingPublicId: correction.correction.bookingPublicId,
          vehicleId: correction.correction.vehicleId,
          inspectionId: correction.correction.inspectionId,
          inspectionType: correction.correction.inspectionType,
          previousOdometerValue: correction.correction.previousOdometerValue,
          previousOdometerDisplay: formatBookingVehicleInspectionOdometer(
            correction.correction.previousOdometerValue,
            correction.correction.odometerUnit,
          ),
          correctedOdometerValue: correction.correction.correctedOdometerValue,
          correctedOdometerDisplay: formatBookingVehicleInspectionOdometer(
            correction.correction.correctedOdometerValue,
            correction.correction.odometerUnit,
          ),
          vehiclePreviousOdometerValue: correction.correction.vehiclePreviousOdometerValue,
          vehiclePreviousOdometerDisplay: formatBookingVehicleInspectionOdometer(
            correction.correction.vehiclePreviousOdometerValue,
            correction.correction.vehiclePreviousOdometerUnit,
          ),
          vehicleNextOdometerValue: correction.correction.correctedOdometerValue,
          vehicleNextOdometerDisplay: formatBookingVehicleInspectionOdometer(
            correction.correction.correctedOdometerValue,
            correction.correction.odometerUnit,
          ),
          correctionReason: correction.correction.correctionReason,
          correctedAt: correction.correction.correctedAt,
          correctedByUserId: correction.correction.correctedByUserId,
          vehicleSourceOfTruthUpdated: true,
        },
      });

      return NextResponse.json({
        ok: true,
        bookingId: inspections.bookingId,
        bookingPublicId: inspections.bookingPublicId,
        vehicleId: inspections.vehicleId,
        inspection: mapInspectionPayload(updatedSummary),
        inspections: mapInspectionSet(inspections),
      });
    } catch (error) {
      if (isBookingVehicleInspectionMissingTableError(error)) {
        return NextResponse.json(
          { ok: false, error: "Booking inspection tables are not installed." },
          { status: 503 },
        );
      }
      logError("admin.booking-inspections.PUT.correction", error, {
        bookingId: id,
        inspectionType,
        actorUserId: auth.actor.userId,
      });
      return NextResponse.json(
        { ok: false, error: "Failed to correct inspection odometer." },
        { status: 500 },
      );
    }
  }

  const status =
    normalizeInspectionStatus(body?.status) ??
    ("markCompleted" in (body ?? {}) && normalizeDamagePresent(body?.markCompleted) ? "COMPLETED" : "DRAFT");

  const odometerValue = normalizeNullableInt(body?.odometerValue ?? body?.odometer_value);
  if (odometerValue !== null && odometerValue < 0) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid non-negative odometer reading." },
      { status: 400 },
    );
  }

  const fuelLevelEighths = normalizeNullableInt(body?.fuelLevelEighths ?? body?.fuel_level_eighths);
  if (
    fuelLevelEighths !== null &&
    (!Number.isInteger(fuelLevelEighths) || fuelLevelEighths < 0 || fuelLevelEighths > 8)
  ) {
    return NextResponse.json(
      { ok: false, error: "Select a supported fuel level from the inspection dropdown." },
      { status: 400 },
    );
  }

  const odometerUnit = normalizeOdometerUnit(body?.odometerUnit ?? body?.odometer_unit, odometerValue);
  const notes = normalizeNotes(body?.notes);
  const damagePresent =
    body && ("damagePresent" in body || "damage_present" in body)
      ? normalizeDamagePresent(body?.damagePresent ?? body?.damage_present)
      : false;

  try {
    const bookingStatus = await resolvedDeps.getBookingStatus(id);
    if (!bookingStatus) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    if (inspectionType === "PICKUP" && !isPickupInspectionEditableForStatus(bookingStatus)) {
      return NextResponse.json(
        { ok: false, error: "Pickup inspection is read-only after pickup is confirmed." },
        { status: 400 },
      );
    }

    if (inspectionType === "RETURN" && !isReturnInspectionAvailableForStatus(bookingStatus)) {
      return NextResponse.json(
        { ok: false, error: "Confirm pickup first, then complete the return inspection." },
        { status: 400 },
      );
    }

    if (inspectionType === "RETURN" && !isReturnInspectionEditableForStatus(bookingStatus)) {
      return NextResponse.json(
        { ok: false, error: "Return inspection is read-only after the booking is completed." },
        { status: 400 },
      );
    }

    const inspectionLabel = getInspectionLabel(inspectionType);

    if (status === "COMPLETED" && odometerValue === null) {
      return NextResponse.json(
        { ok: false, error: `Enter an odometer reading to complete the ${inspectionLabel} inspection.` },
        { status: 400 },
      );
    }

    if (status === "COMPLETED" && fuelLevelEighths === null) {
      return NextResponse.json(
        { ok: false, error: `Select the fuel level to complete the ${inspectionLabel} inspection.` },
        { status: 400 },
      );
    }

    const existingInspections = await resolvedDeps.loadInspections(id);
    if (!existingInspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    if (
      inspectionType === "RETURN" &&
      status === "COMPLETED" &&
      odometerValue !== null &&
      existingInspections.pickup.recordStatus === "COMPLETED" &&
      existingInspections.pickup.odometerValue !== null &&
      odometerValue < existingInspections.pickup.odometerValue
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `Return odometer must be at least the completed pickup reading of ${formatOdometerReading(
            existingInspections.pickup.odometerValue,
            existingInspections.pickup.odometerUnit,
          )}.`,
        },
        { status: 400 },
      );
    }

    const targetInspectionSummary =
      inspectionType === "PICKUP" ? existingInspections.pickup : existingInspections.returnInspection;

    if (
      status === "COMPLETED" &&
      damagePresent &&
      !targetInspectionSummary.images.some((image) => image.category === "DAMAGE")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `Damage is marked for this inspection. Upload at least one image in the Damage category before completing the ${inspectionLabel} inspection.`,
        },
        { status: 400 },
      );
    }

    if (
      odometerValue !== null &&
      existingInspections.vehicleOdometerValue !== null &&
      odometerValue < existingInspections.vehicleOdometerValue
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `Enter an odometer reading at or above the vehicle's current reading of ${formatOdometerReading(
            existingInspections.vehicleOdometerValue,
            existingInspections.vehicleOdometerUnit,
          )}.`,
        },
        { status: 400 },
      );
    }

    const saved = await resolvedDeps.saveInspection(id, {
      inspectionType,
      status,
      odometerValue,
      odometerUnit,
      fuelLevelEighths,
      damagePresent,
      notes,
      recordedByUserId: auth.actor.userId,
    });

    if (!saved) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    if (status === "COMPLETED" && odometerValue !== null) {
      await resolvedDeps.syncVehicleOdometer({
        vehicleId: saved.vehicle_id,
        odometerValue,
        odometerUnit,
      });
    }

    const inspections = await resolvedDeps.loadInspections(id);
    if (!inspections) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    if (inspectionType === "RETURN") {
      try {
        await resolvedDeps.processInspectionIssues(id, inspections, {
          actorUserId: auth.actor.userId,
        });
      } catch (error) {
        logWarn("admin.booking-inspections.issue-processing", {
          bookingId: id,
          inspectionType,
          actorUserId: auth.actor.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await resolvedDeps.writeAudit({
      userId: auth.actor.userId,
      action: "BOOKING_VEHICLE_INSPECTION_UPSERTED",
      entityType: "booking",
      entityId: id,
      details: {
        inspectionType,
        status,
      },
    });

    const updatedSummary =
      inspectionType === "PICKUP" ? inspections.pickup : inspections.returnInspection;

    return NextResponse.json({
      ok: true,
      bookingId: inspections.bookingId,
      bookingPublicId: inspections.bookingPublicId,
      vehicleId: inspections.vehicleId,
      inspection: mapInspectionPayload(updatedSummary),
      inspections: mapInspectionSet(inspections),
    });
  } catch (error) {
    if (isBookingVehicleInspectionMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Booking inspection tables are not installed." },
        { status: 503 },
      );
    }
    logError("admin.booking-inspections.PUT", error, {
      bookingId: id,
      inspectionType,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json({ ok: false, error: "Failed to save booking inspection." }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAdminBookingInspectionsGet(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAdminBookingInspectionsPut(request, context);
}
