export const BOOKING_VEHICLE_INSPECTION_TYPES = ["PICKUP", "RETURN"] as const;
export const BOOKING_VEHICLE_INSPECTION_RECORD_STATUSES = ["DRAFT", "COMPLETED"] as const;
export const BOOKING_VEHICLE_INSPECTION_FUEL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export const BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES = [
  "EXTERIOR",
  "INTERIOR",
  "ODOMETER",
  "FUEL_GAUGE",
  "DAMAGE",
  "OTHER",
] as const;

export type BookingVehicleInspectionType = (typeof BOOKING_VEHICLE_INSPECTION_TYPES)[number];
export type BookingVehicleInspectionRecordStatus =
  (typeof BOOKING_VEHICLE_INSPECTION_RECORD_STATUSES)[number];
export type BookingVehicleInspectionImageCategory =
  (typeof BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES)[number];
export type BookingVehicleInspectionDisplayStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED";

export type BookingVehicleInspectionImageSummary = {
  id: string;
  inspectionId: string;
  inspectionType: BookingVehicleInspectionType;
  category: BookingVehicleInspectionImageCategory;
  categoryLabel: string;
  label: string | null;
  storageProvider: string | null;
  generatedFileName: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  previewUrl: string | null;
  downloadUrl: string | null;
  uploadedByUserId: string | null;
  uploadedByDisplay: string | null;
  createdAt: string | null;
};

export type BookingVehicleInspectionSummary = {
  inspectionType: BookingVehicleInspectionType;
  inspectionId: string | null;
  recordStatus: BookingVehicleInspectionRecordStatus | null;
  displayStatus: BookingVehicleInspectionDisplayStatus;
  displayStatusLabel: "Not started" | "In progress" | "Completed";
  odometerValue: number | null;
  odometerUnit: string | null;
  fuelLevelEighths: number | null;
  fuelLevelDisplay: string;
  damagePresent: boolean | null;
  damageDisplay: string;
  notes: string | null;
  noteSnippet: string | null;
  imageCount: number;
  images: BookingVehicleInspectionImageSummary[];
  recordedByUserId: string | null;
  recordedByDisplay: string | null;
  recordedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  hasOdometerCorrection: boolean;
  odometerCorrectedFromValue: number | null;
  odometerCorrectionReason: string | null;
  odometerCorrectedByUserId: string | null;
  odometerCorrectedByDisplay: string | null;
  odometerCorrectedAt: string | null;
};

export type LoadedBookingVehicleInspections = {
  bookingId: string;
  bookingPublicId: string;
  vehicleId: string;
  vehicleOdometerValue: number | null;
  vehicleOdometerUnit: string | null;
  pickup: BookingVehicleInspectionSummary;
  returnInspection: BookingVehicleInspectionSummary;
};

export type BookingVehicleInspectionIssueCode = "FUEL_MISMATCH" | "RETURN_DAMAGE";

export type BookingVehicleInspectionWarning = {
  code: BookingVehicleInspectionIssueCode;
  label: string;
  description: string;
  severity: "warning" | "danger";
};

export type BookingVehicleInspectionIssueFlags = {
  hasFuelMismatch: boolean;
  hasReturnDamage: boolean;
  warnings: BookingVehicleInspectionWarning[];
};

const FUEL_DISPLAY_LABELS: Record<number, string> = {
  0: "0%",
  1: "12.5%",
  2: "25%",
  3: "37.5%",
  4: "50%",
  5: "62.5%",
  6: "75%",
  7: "87.5%",
  8: "100%",
};

const IMAGE_CATEGORY_LABELS: Record<BookingVehicleInspectionImageCategory, string> = {
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  ODOMETER: "Odometer",
  FUEL_GAUGE: "Fuel gauge",
  DAMAGE: "Damage",
  OTHER: "Other",
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDisplayStatus(
  status: BookingVehicleInspectionRecordStatus | null | undefined,
): BookingVehicleInspectionDisplayStatus {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "DRAFT") return "IN_PROGRESS";
  return "NOT_STARTED";
}

export function getBookingVehicleInspectionStatusLabel(
  status: BookingVehicleInspectionRecordStatus | null | undefined,
): BookingVehicleInspectionSummary["displayStatusLabel"] {
  const normalized = normalizeDisplayStatus(status);
  if (normalized === "COMPLETED") return "Completed";
  if (normalized === "IN_PROGRESS") return "In progress";
  return "Not started";
}

export function formatBookingVehicleInspectionFuelLevel(
  fuelLevelEighths: number | null | undefined,
) {
  if (fuelLevelEighths === null || fuelLevelEighths === undefined) {
    return "Not recorded";
  }
  const normalized = Number(fuelLevelEighths);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 8) {
    return "Not recorded";
  }
  return FUEL_DISPLAY_LABELS[normalized] ?? "Not recorded";
}

export function formatBookingVehicleInspectionImageCategory(
  category: BookingVehicleInspectionImageCategory | null | undefined,
) {
  if (!category) return "Other";
  return IMAGE_CATEGORY_LABELS[category] ?? "Other";
}

export function formatBookingVehicleInspectionOdometer(
  odometerValue: number | null | undefined,
  odometerUnit: string | null | undefined,
) {
  if (odometerValue === null || odometerValue === undefined || !Number.isFinite(Number(odometerValue))) {
    return "Not recorded";
  }
  const normalizedUnit = normalizeText(odometerUnit).toUpperCase() || "KM";
  return `${Number(odometerValue).toLocaleString()} ${normalizedUnit}`;
}

export function isReturnInspectionAvailableForStatus(status: string | null | undefined) {
  const normalized = normalizeText(status).toUpperCase();
  return normalized === "PICKED_UP" || normalized === "RETURNED";
}

export function isReturnInspectionEditableForStatus(status: string | null | undefined) {
  const normalized = normalizeText(status).toUpperCase();
  return normalized === "PICKED_UP";
}

export function isPickupInspectionEditableForStatus(status: string | null | undefined) {
  const normalized = normalizeText(status).toUpperCase();
  return !["PICKED_UP", "RETURNED", "CANCELLED"].includes(normalized);
}

export function getBookingVehicleInspectionOdometerPrefill(
  summary: BookingVehicleInspectionSummary,
  inspections: LoadedBookingVehicleInspections,
) {
  const hasSavedInspection = Boolean(summary.inspectionId);
  if (hasSavedInspection) {
    return {
      odometerValue: summary.odometerValue,
      odometerUnit: summary.odometerUnit ?? inspections.vehicleOdometerUnit ?? "KM",
    };
  }

  return {
    odometerValue: inspections.vehicleOdometerValue,
    odometerUnit: inspections.vehicleOdometerUnit ?? "KM",
  };
}

export function getBookingVehicleInspectionIssueFlags(
  inspections: LoadedBookingVehicleInspections,
): BookingVehicleInspectionIssueFlags {
  const warnings: BookingVehicleInspectionWarning[] = [];
  const pickup = inspections.pickup;
  const returnInspection = inspections.returnInspection;

  const hasFuelMismatch =
    pickup.recordStatus === "COMPLETED" &&
    returnInspection.recordStatus === "COMPLETED" &&
    pickup.fuelLevelEighths !== null &&
    returnInspection.fuelLevelEighths !== null &&
    returnInspection.fuelLevelEighths < pickup.fuelLevelEighths;

  if (hasFuelMismatch) {
    warnings.push({
      code: "FUEL_MISMATCH",
      label: "Fuel mismatch",
      description: `Return fuel (${returnInspection.fuelLevelDisplay}) is below pickup fuel (${pickup.fuelLevelDisplay}).`,
      severity: "warning",
    });
  }

  const hasReturnDamage =
    returnInspection.recordStatus === "COMPLETED" && returnInspection.damagePresent === true;

  if (hasReturnDamage) {
    warnings.push({
      code: "RETURN_DAMAGE",
      label: "Damage reported",
      description: "Return inspection indicates vehicle damage.",
      severity: "danger",
    });
  }

  return {
    hasFuelMismatch,
    hasReturnDamage,
    warnings,
  };
}
