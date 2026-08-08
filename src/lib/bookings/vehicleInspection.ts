import { createHash } from "node:crypto";

import { dbQuery, getDbPool } from "@/lib/db";
import { loadAdminSettings } from "@/lib/adminSettings";
import {
  extractUploadcareDeliveryUrl,
  extractUploadcareFileId,
  normalizeUploadcareDeliveryUrl,
} from "@/lib/uploads/uploadcare";
import { normalizeBunnyStorageKey } from "@/lib/uploads/bunny";
import {
  BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES,
  BOOKING_VEHICLE_INSPECTION_FUEL_LEVELS,
  BOOKING_VEHICLE_INSPECTION_RECORD_STATUSES,
  BOOKING_VEHICLE_INSPECTION_TYPES,
  formatBookingVehicleInspectionOdometer,
  formatBookingVehicleInspectionFuelLevel,
  formatBookingVehicleInspectionImageCategory,
  getBookingVehicleInspectionIssueFlags,
  getBookingVehicleInspectionOdometerPrefill,
  getBookingVehicleInspectionStatusLabel,
  isPickupInspectionEditableForStatus,
  isReturnInspectionEditableForStatus,
  isReturnInspectionAvailableForStatus,
  type BookingVehicleInspectionImageCategory,
  type BookingVehicleInspectionImageSummary,
  type BookingVehicleInspectionDisplayStatus,
  type BookingVehicleInspectionRecordStatus,
  type BookingVehicleInspectionSummary,
  type BookingVehicleInspectionType,
  type LoadedBookingVehicleInspections,
} from "@/lib/bookings/vehicleInspectionShared";
import { markDedupeResult, tryAcquireDedupe, computeDedupeKey } from "@/lib/notifications/dedupe";
import { sendOperationalAlertEmail } from "@/lib/notifications/email";
import { insertMailboxMessage } from "@/lib/messages/mailboxStore";
import { loadOperationalNotificationRoutingSummary } from "@/lib/notifications/operationalRouting";
type DbQueryFn = typeof dbQuery;

export {
  BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES,
  BOOKING_VEHICLE_INSPECTION_FUEL_LEVELS,
  BOOKING_VEHICLE_INSPECTION_RECORD_STATUSES,
  BOOKING_VEHICLE_INSPECTION_TYPES,
  formatBookingVehicleInspectionOdometer,
  formatBookingVehicleInspectionFuelLevel,
  formatBookingVehicleInspectionImageCategory,
  getBookingVehicleInspectionIssueFlags,
  getBookingVehicleInspectionOdometerPrefill,
  getBookingVehicleInspectionStatusLabel,
  isPickupInspectionEditableForStatus,
  isReturnInspectionEditableForStatus,
  isReturnInspectionAvailableForStatus,
};
export type {
  BookingVehicleInspectionImageCategory,
  BookingVehicleInspectionImageSummary,
  BookingVehicleInspectionDisplayStatus,
  BookingVehicleInspectionRecordStatus,
  BookingVehicleInspectionSummary,
  BookingVehicleInspectionType,
  LoadedBookingVehicleInspections,
};

type BookingMetaRow = {
  booking_id: string;
  booking_public_id: string | null;
  vehicle_id: string;
  vehicle_odometer_value: number | null;
  vehicle_odometer_unit: string | null;
};

type BookingVehicleInspectionRow = {
  id: string;
  booking_id: string;
  vehicle_id: string;
  inspection_type: BookingVehicleInspectionType;
  status: BookingVehicleInspectionRecordStatus;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_eighths: number | null;
  damage_present: boolean | null;
  notes: string | null;
  recorded_by_user_id: string | null;
  recorded_by_display: string | null;
  odometer_corrected_from_value: number | null;
  odometer_correction_reason: string | null;
  odometer_corrected_by_user_id: string | null;
  odometer_corrected_by_display: string | null;
  odometer_corrected_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  image_count: number | string | null;
};

type BookingVehicleInspectionImageRow = {
  id: string;
  inspection_id: string;
  booking_id: string;
  inspection_type: BookingVehicleInspectionType;
  category: BookingVehicleInspectionImageCategory;
  label: string | null;
  storage_provider: string | null;
  storage_key: string;
  original_file_name: string | null;
  generated_file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  uploaded_by_user_id: string | null;
  uploaded_by_display: string | null;
  created_at: string;
};

export type UpsertBookingVehicleInspectionInput = {
  inspectionType: BookingVehicleInspectionType;
  status: BookingVehicleInspectionRecordStatus;
  odometerValue: number | null;
  odometerUnit: string | null;
  fuelLevelEighths: number | null;
  damagePresent: boolean;
  notes: string | null;
  recordedByUserId: string | null;
};

export type CreateBookingVehicleInspectionImagesInput = {
  inspectionId: string;
  inspectionType: BookingVehicleInspectionType;
  category: BookingVehicleInspectionImageCategory;
  files: Array<{
    storageProvider?: string | null;
    storageKey: string;
    originalFileName?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    label?: string | null;
  }>;
  uploadedByUserId: string | null;
};

export type ArchiveBookingVehicleInspectionImageInput = {
  imageId: string;
  inspectionId: string;
  inspectionType: BookingVehicleInspectionType;
};

export const BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVE_MIN_AGE_DAYS = 365;

export type BookingVehicleInspectionImageArchiveReasonCode =
  | "ALREADY_ARCHIVED"
  | "BOOKING_NOT_RETURNED"
  | "BOOKING_TOO_RECENT"
  | "PICKUP_INSPECTION_INCOMPLETE"
  | "RETURN_INSPECTION_INCOMPLETE"
  | "RETURN_DAMAGE_REPORTED"
  | "FUEL_MISMATCH_PRESENT"
  | "REFUND_OR_REVIEW_PRESENT"
  | "DAMAGE_CATEGORY_PRESERVED";

export type BookingVehicleInspectionImageArchivePolicy = {
  minimumAgeDays: number;
  evaluatedAt: string;
  eligibleBefore: string;
  bookingStatus: string | null;
  bookingCompleted: boolean;
  bookingOldEnough: boolean;
  pickupCompleted: boolean;
  returnCompleted: boolean;
  hasReturnDamage: boolean;
  hasFuelMismatch: boolean;
  hasRefundOrReview: boolean;
};

export type BookingVehicleInspectionImageArchiveCandidate = {
  imageId: string;
  inspectionId: string;
  inspectionType: BookingVehicleInspectionType;
  category: BookingVehicleInspectionImageCategory;
  generatedFileName: string | null;
  originalFileName: string | null;
  createdAt: string | null;
  archivedAt: string | null;
  eligible: boolean;
  reasons: BookingVehicleInspectionImageArchiveReasonCode[];
};

export type BookingVehicleInspectionImageArchiveEvaluation = {
  bookingId: string;
  bookingPublicId: string;
  vehicleId: string;
  policy: BookingVehicleInspectionImageArchivePolicy;
  candidates: BookingVehicleInspectionImageArchiveCandidate[];
  eligibleCount: number;
  ineligibleCount: number;
};

export type ArchiveEligibleBookingVehicleInspectionImagesInput = {
  imageIds?: string[] | null;
  archiveReason?: string | null;
  archiveSource?: string | null;
  actorUserId?: string | null;
};

export type BookingVehicleInspectionImageArchiveActionResult =
  BookingVehicleInspectionImageArchiveCandidate & {
    outcome: "ARCHIVED" | "SKIPPED";
    archivedAt: string | null;
  };

export type ArchiveEligibleBookingVehicleInspectionImagesResult = {
  bookingId: string;
  bookingPublicId: string;
  vehicleId: string;
  archiveReason: string;
  archiveSource: string;
  policy: BookingVehicleInspectionImageArchivePolicy;
  eligibleCount: number;
  ineligibleCount: number;
  archivedCount: number;
  skippedCount: number;
  results: BookingVehicleInspectionImageArchiveActionResult[];
};

type LoadBookingVehicleInspectionDeps = {
  query?: DbQueryFn;
};

type UpsertBookingVehicleInspectionDeps = {
  query?: DbQueryFn;
};

type CreateBookingVehicleInspectionImagesDeps = {
  query?: DbQueryFn;
};

type ArchiveBookingVehicleInspectionImageDeps = {
  query?: DbQueryFn;
};

type EvaluateBookingVehicleInspectionImageArchiveDeps = {
  query?: DbQueryFn;
  loadInspections?: typeof loadBookingVehicleInspectionSummaries;
  now?: Date;
};

type ArchiveEligibleBookingVehicleInspectionImagesDeps = {
  query?: DbQueryFn;
  loadInspections?: typeof loadBookingVehicleInspectionSummaries;
  writeAudit?: (input: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
  now?: Date;
};

type SyncVehicleOdometerDeps = {
  query?: DbQueryFn;
};

export type CorrectBookingVehicleInspectionOdometerInput = {
  inspectionId: string;
  inspectionType: BookingVehicleInspectionType;
  correctedOdometerValue: number;
  correctionReason: string;
  correctedByUserId: string | null;
};

export type CorrectBookingVehicleInspectionOdometerResult =
  | {
      ok: true;
      correction: {
        bookingId: string;
        bookingPublicId: string;
        vehicleId: string;
        inspectionId: string;
        inspectionType: BookingVehicleInspectionType;
        previousOdometerValue: number | null;
        correctedOdometerValue: number;
        odometerUnit: string | null;
        vehiclePreviousOdometerValue: number | null;
        vehiclePreviousOdometerUnit: string | null;
        correctionReason: string;
        correctedByUserId: string | null;
        correctedAt: string;
      };
    }
  | { ok: false; status: 400 | 404; error: string };

type RunDbTransaction = <T>(callback: (query: DbQueryFn) => Promise<T>) => Promise<T>;

type CorrectBookingVehicleInspectionOdometerDeps = {
  runInTransaction?: RunDbTransaction;
};

type HasCompletedBookingVehicleInspectionDeps = {
  query?: DbQueryFn;
};

type ProcessBookingVehicleInspectionIssuesDeps = {
  query?: DbQueryFn;
  insertAdminNotification?: (input: {
    recipientEmail: string;
    message: string;
  }) => Promise<{ id: string | null } | null>;
  writeAudit?: (input: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
  loadSettings?: typeof loadAdminSettings;
  resolveOperationalRouting?: typeof loadOperationalNotificationRoutingSummary;
  sendWarningEmail?: typeof sendOperationalAlertEmail;
  acquireDedupe?: typeof tryAcquireDedupe;
  recordDedupeResult?: typeof markDedupeResult;
  actorUserId?: string | null;
};

type BookingVehicleInspectionAlertContext = {
  bookingId: string;
  bookingPublicId: string;
  customerName: string | null;
  customerEmail: string | null;
  vehicleLabel: string | null;
};

type BookingVehicleInspectionImageArchiveContextRow = {
  booking_id: string;
  booking_public_id: string | null;
  vehicle_id: string;
  booking_status: string | null;
  booking_end_date: string | null;
  booking_created_at: string | null;
  pricing_json: Record<string, unknown> | null;
  refund_like_payment_count: number | string | null;
};

type BookingVehicleInspectionImageArchiveRow = {
  image_id: string;
  inspection_id: string;
  inspection_type: BookingVehicleInspectionType;
  category: BookingVehicleInspectionImageCategory;
  generated_file_name: string | null;
  original_file_name: string | null;
  created_at: string | null;
  archived_at: string | null;
};

const INSPECTION_TABLE_NAMES = new Set([
  "booking_vehicle_inspections",
  "booking_vehicle_inspection_images",
]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown, max = 255) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function normalizeNullableDate(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function buildNoteSnippet(notes: string | null) {
  const normalized = normalizeText(notes);
  if (!normalized) return null;
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137)}...`;
}

function toImageCount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeStorageProvider(value: unknown) {
  return normalizeText(value).toUpperCase() || "UPLOADCARE_FILE_ID";
}

function normalizeByteSize(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function resolveInspectionImageUrl(storageProvider: unknown, storageKey: unknown) {
  const normalizedStorageKey = normalizeText(storageKey);
  if (!normalizedStorageKey) return null;

  const provider = normalizeStorageProvider(storageProvider);
  if (!["UPLOADCARE_FILE_ID", "UPLOADCARE", "UPLOADCARE_TOKEN"].includes(provider)) {
    return null;
  }

  return normalizeUploadcareDeliveryUrl(normalizedStorageKey);
}

function inferImageExtension(input: { mimeType?: string | null; originalFileName?: string | null }) {
  const originalFileName = normalizeText(input.originalFileName);
  const match = originalFileName.match(/\.([a-z0-9]{2,8})$/i);
  if (match?.[1]) return match[1].toLowerCase();

  const mimeType = normalizeText(input.mimeType).toLowerCase();
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}

function normalizeDisplayStatus(
  status: BookingVehicleInspectionRecordStatus | null | undefined,
): BookingVehicleInspectionDisplayStatus {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "DRAFT") return "IN_PROGRESS";
  return "NOT_STARTED";
}

export function buildBookingVehicleInspectionImageFileName(input: {
  bookingPublicId: string;
  inspectionType: BookingVehicleInspectionType;
  category: string;
  capturedAt?: string | Date | null;
  index?: number | null;
  extension?: string | null;
}) {
  const bookingPublicId = normalizeText(input.bookingPublicId) || "BOOKING";
  const inspectionType = input.inspectionType.toLowerCase();
  const category = (normalizeText(input.category).toLowerCase() || "other")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "other";
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const timestamp = Number.isFinite(capturedAt.getTime())
    ? capturedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    : "unknown";
  const index =
    Number.isInteger(input.index) && Number(input.index) > 0
      ? `-${String(input.index).padStart(2, "0")}`
      : "";
  const extension =
    normalizeText(input.extension).replace(/^\./, "").toLowerCase() || "jpg";
  return `${bookingPublicId}-${inspectionType}-${category}-${timestamp}${index}.${extension}`;
}

export function isBookingVehicleInspectionMissingTableError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  if (code !== "42P01") return false;

  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  for (const tableName of INSPECTION_TABLE_NAMES) {
    if (message.includes(tableName)) return true;
  }
  return false;
}

function mapInspectionSummary(
  inspectionType: BookingVehicleInspectionType,
  row: BookingVehicleInspectionRow | null | undefined,
  images: BookingVehicleInspectionImageSummary[] = [],
): BookingVehicleInspectionSummary {
  const recordStatus = row?.status ?? null;
  return {
    inspectionType,
    inspectionId: row?.id ?? null,
    recordStatus,
    displayStatus: normalizeDisplayStatus(recordStatus),
    displayStatusLabel: getBookingVehicleInspectionStatusLabel(recordStatus),
    odometerValue: row?.odometer_value ?? null,
    odometerUnit: normalizeNullableText(row?.odometer_unit),
    fuelLevelEighths: row?.fuel_level_eighths ?? null,
    fuelLevelDisplay: formatBookingVehicleInspectionFuelLevel(row?.fuel_level_eighths ?? null),
    damagePresent:
      typeof row?.damage_present === "boolean" ? row.damage_present : null,
    damageDisplay:
      typeof row?.damage_present === "boolean"
        ? row.damage_present
          ? "Yes"
          : "No"
        : "Not recorded",
    notes: normalizeNullableText(row?.notes),
    noteSnippet: buildNoteSnippet(row?.notes ?? null),
    imageCount: images.length > 0 ? images.length : toImageCount(row?.image_count),
    images,
    recordedByUserId: normalizeNullableText(row?.recorded_by_user_id),
    recordedByDisplay: normalizeNullableText(row?.recorded_by_display),
    recordedAt: row?.completed_at ?? row?.updated_at ?? row?.created_at ?? null,
    completedAt: row?.completed_at ?? null,
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
    hasOdometerCorrection: row?.odometer_corrected_at !== null && row?.odometer_corrected_at !== undefined,
    odometerCorrectedFromValue: row?.odometer_corrected_from_value ?? null,
    odometerCorrectionReason: normalizeNullableText(row?.odometer_correction_reason),
    odometerCorrectedByUserId: normalizeNullableText(row?.odometer_corrected_by_user_id),
    odometerCorrectedByDisplay: normalizeNullableText(row?.odometer_corrected_by_display),
    odometerCorrectedAt: row?.odometer_corrected_at ?? null,
  };
}

export function createEmptyBookingVehicleInspectionSummaries(input: {
  bookingId: string;
  bookingPublicId: string;
  vehicleId: string;
  vehicleOdometerValue?: number | null;
  vehicleOdometerUnit?: string | null;
}): LoadedBookingVehicleInspections {
  return {
    bookingId: input.bookingId,
    bookingPublicId: input.bookingPublicId,
    vehicleId: input.vehicleId,
    vehicleOdometerValue: input.vehicleOdometerValue ?? null,
    vehicleOdometerUnit: normalizeNullableText(input.vehicleOdometerUnit),
    pickup: mapInspectionSummary("PICKUP", null, []),
    returnInspection: mapInspectionSummary("RETURN", null, []),
  };
}

async function loadBookingMeta(bookingId: string, query: DbQueryFn) {
  const result = await query<BookingMetaRow>(
    `select
       b.id as booking_id,
       b.public_id as booking_public_id,
       b.vehicle_id,
       vp.odometer_value as vehicle_odometer_value,
       vp.odometer_unit as vehicle_odometer_unit
     from bookings b
     left join vehicle_profiles vp
       on vp.vehicle_id = b.vehicle_id
     where b.id = $1::uuid
     limit 1`,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

async function listInspectionRows(
  bookingId: string,
  query: DbQueryFn,
): Promise<BookingVehicleInspectionRow[]> {
  const result = await query<BookingVehicleInspectionRow>(
    `select
       i.id,
       i.booking_id,
       i.vehicle_id,
       i.inspection_type,
       i.status,
       i.odometer_value,
       i.odometer_unit,
       i.fuel_level_eighths,
       i.damage_present,
       i.notes,
       i.recorded_by_user_id,
       coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.username), ''), nullif(trim(u.email), '')) as recorded_by_display,
       i.odometer_corrected_from_value,
       i.odometer_correction_reason,
       i.odometer_corrected_by_user_id,
       coalesce(nullif(trim(cu.full_name), ''), nullif(trim(cu.username), ''), nullif(trim(cu.email), '')) as odometer_corrected_by_display,
       i.odometer_corrected_at,
       i.completed_at,
       i.created_at,
       i.updated_at,
       count(img.id)::int as image_count
     from booking_vehicle_inspections i
     left join booking_vehicle_inspection_images img
       on img.inspection_id = i.id
      and img.archived_at is null
     left join users u
       on u.id = i.recorded_by_user_id
     left join users cu
       on cu.id = i.odometer_corrected_by_user_id
     where i.booking_id = $1::uuid
     group by
       i.id,
       i.booking_id,
       i.vehicle_id,
       i.inspection_type,
       i.status,
       i.odometer_value,
       i.odometer_unit,
       i.fuel_level_eighths,
       i.damage_present,
       i.notes,
       i.recorded_by_user_id,
       u.full_name,
       u.username,
       u.email,
       i.odometer_corrected_from_value,
       i.odometer_correction_reason,
       i.odometer_corrected_by_user_id,
       cu.full_name,
       cu.username,
       cu.email,
       i.odometer_corrected_at,
       i.completed_at,
       i.created_at,
       i.updated_at
     order by case when i.inspection_type = 'PICKUP' then 0 else 1 end, i.updated_at desc`,
    [bookingId],
  );
  return result.rows;
}

function mapInspectionImage(row: BookingVehicleInspectionImageRow): BookingVehicleInspectionImageSummary {
  const hasValidStorage = Boolean(
    resolveInspectionImageUrl(row.storage_provider, row.storage_key),
  );
  const previewUrl = hasValidStorage
    ? `/api/admin/bookings/${encodeURIComponent(row.booking_id)}/inspections/images/${encodeURIComponent(row.id)}`
    : null;
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    inspectionType: row.inspection_type,
    category: row.category,
    categoryLabel: formatBookingVehicleInspectionImageCategory(row.category),
    label: normalizeNullableText(row.label),
    storageProvider: normalizeNullableText(row.storage_provider),
    generatedFileName: normalizeNullableText(row.generated_file_name),
    originalFileName: normalizeNullableText(row.original_file_name),
    mimeType: normalizeNullableText(row.mime_type),
    sizeBytes: normalizeByteSize(row.byte_size),
    previewUrl,
    downloadUrl: previewUrl,
    uploadedByUserId: normalizeNullableText(row.uploaded_by_user_id),
    uploadedByDisplay: normalizeNullableText(row.uploaded_by_display),
    createdAt: row.created_at ?? null,
  };
}

async function listInspectionImageRows(
  bookingId: string,
  query: DbQueryFn,
): Promise<BookingVehicleInspectionImageRow[]> {
  const result = await query<BookingVehicleInspectionImageRow>(
    `select
       img.id,
       img.inspection_id,
       img.booking_id,
       img.inspection_type,
       img.category,
       img.label,
       img.storage_provider,
       img.storage_key,
       img.original_file_name,
       img.generated_file_name,
       img.mime_type,
       img.byte_size,
       img.uploaded_by_user_id,
       coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.username), ''), nullif(trim(u.email), '')) as uploaded_by_display,
       img.created_at
     from booking_vehicle_inspection_images img
     left join users u
       on u.id = img.uploaded_by_user_id
     where img.booking_id = $1::uuid
       and img.archived_at is null
     order by img.inspection_type asc, img.sort_order asc, img.created_at asc`,
    [bookingId],
  );
  return result.rows;
}

export async function loadBookingVehicleInspectionSummaries(
  bookingId: string,
  deps: LoadBookingVehicleInspectionDeps = {},
): Promise<LoadedBookingVehicleInspections | null> {
  const query = deps.query ?? dbQuery;
  const booking = await loadBookingMeta(bookingId, query);
  if (!booking) {
    return null;
  }

  const rows = await listInspectionRows(booking.booking_id, query);
  const imageRows = await listInspectionImageRows(booking.booking_id, query);
  const imagesByInspectionId = new Map<string, BookingVehicleInspectionImageSummary[]>();
  for (const row of imageRows) {
    const current = imagesByInspectionId.get(row.inspection_id) ?? [];
    current.push(mapInspectionImage(row));
    imagesByInspectionId.set(row.inspection_id, current);
  }
  const pickupRow =
    rows.find((row: BookingVehicleInspectionRow) => row.inspection_type === "PICKUP") ?? null;
  const returnRow =
    rows.find((row: BookingVehicleInspectionRow) => row.inspection_type === "RETURN") ?? null;
  const bookingPublicId = normalizeText(booking.booking_public_id) || booking.booking_id;

  return {
    bookingId: booking.booking_id,
    bookingPublicId,
    vehicleId: booking.vehicle_id,
    vehicleOdometerValue: booking.vehicle_odometer_value ?? null,
    vehicleOdometerUnit: normalizeNullableText(booking.vehicle_odometer_unit),
    pickup: mapInspectionSummary(
      "PICKUP",
      pickupRow,
      pickupRow ? (imagesByInspectionId.get(pickupRow.id) ?? []) : [],
    ),
    returnInspection: mapInspectionSummary(
      "RETURN",
      returnRow,
      returnRow ? (imagesByInspectionId.get(returnRow.id) ?? []) : [],
    ),
  };
}

export async function upsertBookingVehicleInspection(
  bookingId: string,
  input: UpsertBookingVehicleInspectionInput,
  deps: UpsertBookingVehicleInspectionDeps = {},
) {
  const query = deps.query ?? dbQuery;
  const completedAt = input.status === "COMPLETED" ? new Date().toISOString() : null;
  const result = await query<BookingVehicleInspectionRow>(
    `with upserted as (
       insert into booking_vehicle_inspections (
         booking_id,
         vehicle_id,
         inspection_type,
         status,
         odometer_value,
         odometer_unit,
         fuel_level_eighths,
         damage_present,
         notes,
         recorded_by_user_id,
         completed_at
       )
       select
         b.id,
         b.vehicle_id,
         $2::text,
         $3::text,
         $4::int,
         $5,
         $6::int,
         $7::boolean,
         $8,
         $9::uuid,
         $10::timestamptz
       from bookings b
       where b.id = $1::uuid
       on conflict (booking_id, inspection_type) do update
         set vehicle_id = excluded.vehicle_id,
             status = excluded.status,
             odometer_value = excluded.odometer_value,
             odometer_unit = excluded.odometer_unit,
             fuel_level_eighths = excluded.fuel_level_eighths,
             damage_present = excluded.damage_present,
             notes = excluded.notes,
             recorded_by_user_id = excluded.recorded_by_user_id,
             completed_at = case
               when excluded.status = 'COMPLETED'
                 then coalesce(booking_vehicle_inspections.completed_at, excluded.completed_at, now())
               else null
             end,
             updated_at = now()
       returning *
     )
     select
       u.id,
       u.booking_id,
       u.vehicle_id,
       u.inspection_type,
       u.status,
       u.odometer_value,
       u.odometer_unit,
       u.fuel_level_eighths,
       u.damage_present,
       u.notes,
       u.recorded_by_user_id,
       coalesce(nullif(trim(rec.full_name), ''), nullif(trim(rec.username), ''), nullif(trim(rec.email), '')) as recorded_by_display,
       u.odometer_corrected_from_value,
       u.odometer_correction_reason,
       u.odometer_corrected_by_user_id,
       coalesce(nullif(trim(corr.full_name), ''), nullif(trim(corr.username), ''), nullif(trim(corr.email), '')) as odometer_corrected_by_display,
       u.odometer_corrected_at,
       u.completed_at,
       u.created_at,
       u.updated_at,
       (
         select count(*)::int
         from booking_vehicle_inspection_images img
         where img.inspection_id = u.id
           and img.archived_at is null
       ) as image_count
     from upserted u
     left join users rec
       on rec.id = u.recorded_by_user_id
     left join users corr
       on corr.id = u.odometer_corrected_by_user_id`,
    [
      bookingId,
      input.inspectionType,
      input.status,
      input.odometerValue,
      input.odometerUnit,
      input.fuelLevelEighths,
      input.damagePresent,
      input.notes,
      input.recordedByUserId,
      completedAt,
    ],
  );
  return result.rows[0] ?? null;
}

async function loadBookingInspectionImageTarget(
  bookingId: string,
  inspectionId: string,
  inspectionType: BookingVehicleInspectionType,
  query: DbQueryFn,
) {
  const result = await query<{
    booking_id: string;
    booking_public_id: string | null;
    inspection_id: string;
    inspection_type: BookingVehicleInspectionType;
  }>(
    `select
       b.id as booking_id,
       b.public_id as booking_public_id,
       i.id as inspection_id,
       i.inspection_type
     from bookings b
     join booking_vehicle_inspections i
       on i.booking_id = b.id
     where b.id = $1::uuid
       and i.id = $2::uuid
       and i.inspection_type = $3::text
     limit 1`,
    [bookingId, inspectionId, inspectionType],
  );
  return result.rows[0] ?? null;
}

export async function createBookingVehicleInspectionImages(
  bookingId: string,
  input: CreateBookingVehicleInspectionImagesInput,
  deps: CreateBookingVehicleInspectionImagesDeps = {},
) {
  const query = deps.query ?? dbQuery;
  const target = await loadBookingInspectionImageTarget(
    bookingId,
    input.inspectionId,
    input.inspectionType,
    query,
  );
  if (!target) return [];

  const maxSortOrderResult = await query<{ max_sort_order: number | null }>(
    `select max(sort_order)::int as max_sort_order
     from booking_vehicle_inspection_images
     where inspection_id = $1::uuid
       and archived_at is null`,
    [input.inspectionId],
  );
  const startingSortOrder = Number(maxSortOrderResult.rows[0]?.max_sort_order ?? -1);
  const createdRows: BookingVehicleInspectionImageRow[] = [];

  for (const [index, file] of input.files.entries()) {
    const storageProvider = normalizeStorageProvider(file.storageProvider);
    const rawStorageKey = normalizeText(file.storageKey);
    const normalizedStorageKey = ["UPLOADCARE_FILE_ID", "UPLOADCARE", "UPLOADCARE_TOKEN"].includes(storageProvider)
      ? extractUploadcareDeliveryUrl(rawStorageKey) ?? extractUploadcareFileId(rawStorageKey)
      : storageProvider === "BUNNY_STORAGE"
        ? (() => {
            try {
              const key = normalizeBunnyStorageKey(rawStorageKey);
              return key.startsWith("private/bookings/") ? key : null;
            } catch {
              return null;
            }
          })()
         : null;
    if (!normalizedStorageKey) {
      throw new Error("INVALID_IMAGE_STORAGE_REFERENCE");
    }

    const generatedFileName = buildBookingVehicleInspectionImageFileName({
      bookingPublicId: normalizeText(target.booking_public_id) || target.booking_id,
      inspectionType: input.inspectionType,
      category: input.category,
      index: startingSortOrder + index + 2,
      extension: inferImageExtension({
        mimeType: file.mimeType,
        originalFileName: file.originalFileName,
      }),
    });

    const result = await query<BookingVehicleInspectionImageRow>(
      `insert into booking_vehicle_inspection_images (
         inspection_id,
         booking_id,
         inspection_type,
         category,
         label,
         storage_provider,
         storage_key,
         original_file_name,
         generated_file_name,
         mime_type,
         byte_size,
         sort_order,
         metadata_json,
         uploaded_by_user_id
       ) values (
         $1::uuid,
         $2::uuid,
         $3::text,
         $4::text,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11::int,
         $12::int,
         $13::jsonb,
         $14::uuid
       )
       returning
         id,
         inspection_id,
         booking_id,
         inspection_type,
         category,
         label,
         storage_provider,
         storage_key,
         original_file_name,
         generated_file_name,
         mime_type,
         byte_size,
         uploaded_by_user_id,
         null::text as uploaded_by_display,
         created_at`,
      [
        input.inspectionId,
        bookingId,
        input.inspectionType,
        input.category,
        normalizeNullableText(file.label, 140),
        storageProvider,
        normalizedStorageKey,
        normalizeNullableText(file.originalFileName, 255),
        generatedFileName,
        normalizeNullableText(file.mimeType, 120),
        normalizeByteSize(file.sizeBytes),
        startingSortOrder + index + 1,
        {
          bookingPublicId: normalizeText(target.booking_public_id) || target.booking_id,
          inspectionType: input.inspectionType,
          category: input.category,
          generatedFileName,
          source: "booking_vehicle_inspection",
        },
        input.uploadedByUserId,
      ],
    );
    if (result.rows[0]) {
      createdRows.push(result.rows[0]);
    }
  }

  return createdRows.map(mapInspectionImage);
}

export async function archiveBookingVehicleInspectionImage(
  bookingId: string,
  input: ArchiveBookingVehicleInspectionImageInput,
  deps: ArchiveBookingVehicleInspectionImageDeps = {},
) {
  const query = deps.query ?? dbQuery;
  const result = await query<{ id: string }>(
    `update booking_vehicle_inspection_images img
     set archived_at = now()
     where img.id = $1::uuid
       and img.booking_id = $2::uuid
       and img.inspection_id = $3::uuid
       and img.inspection_type = $4::text
       and img.archived_at is null
     returning img.id`,
    [input.imageId, bookingId, input.inspectionId, input.inspectionType],
  );
  return result.rowCount > 0;
}

async function loadBookingVehicleInspectionImageArchiveContext(
  bookingId: string,
  query: DbQueryFn,
) {
  const result = await query<BookingVehicleInspectionImageArchiveContextRow>(
    `select
       b.id as booking_id,
       b.public_id as booking_public_id,
       b.vehicle_id,
       b.status as booking_status,
       b.end_date::text as booking_end_date,
       b.created_at::text as booking_created_at,
       b.pricing_json,
       coalesce(
         sum(
           case
             when p.deleted_at is null
               and (
                 upper(coalesce(p.status, '')) = 'REFUNDED'
                 or p.deposit_amount_cents < 0
                 or lower(coalesce(p.metadata_json->>'payment_type', '')) = 'refund'
               )
             then 1
             else 0
           end
         ),
         0
       )::int as refund_like_payment_count
     from bookings b
     left join payments p
       on p.booking_id = b.id
     where b.id = $1::uuid
     group by
       b.id,
       b.public_id,
       b.vehicle_id,
       b.status,
       b.end_date,
       b.created_at,
       b.pricing_json
     limit 1`,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

async function listBookingVehicleInspectionImageArchiveRows(
  bookingId: string,
  imageIds: string[],
  query: DbQueryFn,
) {
  const values: unknown[] = [bookingId];
  const filters = ["img.booking_id = $1::uuid"];
  if (imageIds.length > 0) {
    values.push(imageIds);
    filters.push(`img.id = any($2::uuid[])`);
  }

  const result = await query<BookingVehicleInspectionImageArchiveRow>(
    `select
       img.id as image_id,
       img.inspection_id,
       img.inspection_type,
       img.category,
       img.generated_file_name,
       img.original_file_name,
       img.created_at,
       img.archived_at
     from booking_vehicle_inspection_images img
     where ${filters.join(" and ")}
     order by img.inspection_type asc, img.sort_order asc, img.created_at asc`,
    values,
  );
  return result.rows;
}

function hasRefundOrReviewSignal(
  context: BookingVehicleInspectionImageArchiveContextRow,
) {
  const pricing = normalizeJsonObject(context.pricing_json);
  const paymentStatus = normalizeText(
    pricing?.payment_status ?? pricing?.paymentStatus,
  ).toUpperCase();
  return (
    normalizeBoolean(pricing?.refund_required ?? pricing?.refundRequired) ||
    paymentStatus.includes("REFUND") ||
    Number(context.refund_like_payment_count ?? 0) > 0
  );
}

function buildBookingVehicleInspectionImageArchivePolicy(input: {
  context: BookingVehicleInspectionImageArchiveContextRow;
  inspections: LoadedBookingVehicleInspections;
  now: Date;
}) {
  const evaluatedAt = new Date(input.now);
  const archiveEligibleBefore = new Date(evaluatedAt);
  archiveEligibleBefore.setUTCDate(
    archiveEligibleBefore.getUTCDate() - BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVE_MIN_AGE_DAYS,
  );

  const bookingAgeAnchor =
    normalizeNullableDate(input.context.booking_end_date) ??
    normalizeNullableDate(input.context.booking_created_at);
  const bookingStatus = normalizeNullableText(input.context.booking_status, 32);
  const issueFlags = getBookingVehicleInspectionIssueFlags(input.inspections);

  return {
    minimumAgeDays: BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVE_MIN_AGE_DAYS,
    evaluatedAt: evaluatedAt.toISOString(),
    eligibleBefore: archiveEligibleBefore.toISOString(),
    bookingStatus,
    bookingCompleted: normalizeText(bookingStatus).toUpperCase() === "RETURNED",
    bookingOldEnough:
      bookingAgeAnchor !== null && bookingAgeAnchor.getTime() <= archiveEligibleBefore.getTime(),
    pickupCompleted: input.inspections.pickup.recordStatus === "COMPLETED",
    returnCompleted: input.inspections.returnInspection.recordStatus === "COMPLETED",
    hasReturnDamage: issueFlags.hasReturnDamage,
    hasFuelMismatch: issueFlags.hasFuelMismatch,
    hasRefundOrReview: hasRefundOrReviewSignal(input.context),
  } satisfies BookingVehicleInspectionImageArchivePolicy;
}

function buildBookingVehicleInspectionImageArchiveReasons(input: {
  image: BookingVehicleInspectionImageArchiveRow;
  policy: BookingVehicleInspectionImageArchivePolicy;
}) {
  const reasons: BookingVehicleInspectionImageArchiveReasonCode[] = [];

  if (input.image.archived_at) {
    reasons.push("ALREADY_ARCHIVED");
  }
  if (!input.policy.bookingCompleted) {
    reasons.push("BOOKING_NOT_RETURNED");
  }
  if (!input.policy.bookingOldEnough) {
    reasons.push("BOOKING_TOO_RECENT");
  }
  if (!input.policy.pickupCompleted) {
    reasons.push("PICKUP_INSPECTION_INCOMPLETE");
  }
  if (!input.policy.returnCompleted) {
    reasons.push("RETURN_INSPECTION_INCOMPLETE");
  }
  if (input.policy.hasReturnDamage) {
    reasons.push("RETURN_DAMAGE_REPORTED");
  }
  if (input.policy.hasFuelMismatch) {
    reasons.push("FUEL_MISMATCH_PRESENT");
  }
  if (input.policy.hasRefundOrReview) {
    reasons.push("REFUND_OR_REVIEW_PRESENT");
  }
  if (input.image.category === "DAMAGE") {
    reasons.push("DAMAGE_CATEGORY_PRESERVED");
  }

  return reasons;
}

export async function evaluateBookingVehicleInspectionImageArchiveCandidates(
  bookingId: string,
  input: { imageIds?: string[] | null } = {},
  deps: EvaluateBookingVehicleInspectionImageArchiveDeps = {},
): Promise<BookingVehicleInspectionImageArchiveEvaluation | null> {
  const query = deps.query ?? dbQuery;
  const loadInspections = deps.loadInspections ?? loadBookingVehicleInspectionSummaries;
  const now = deps.now ?? new Date();

  const context = await loadBookingVehicleInspectionImageArchiveContext(bookingId, query);
  if (!context) return null;

  const inspections = await loadInspections(bookingId, { query });
  if (!inspections) return null;

  const imageIds = Array.isArray(input.imageIds)
    ? input.imageIds.filter(Boolean)
    : [];
  const imageRows = await listBookingVehicleInspectionImageArchiveRows(bookingId, imageIds, query);
  const policy = buildBookingVehicleInspectionImageArchivePolicy({
    context,
    inspections,
    now,
  });

  const candidates: BookingVehicleInspectionImageArchiveCandidate[] = imageRows.map(
    (row: BookingVehicleInspectionImageArchiveRow) => {
    const reasons = buildBookingVehicleInspectionImageArchiveReasons({
      image: row,
      policy,
    });
    return {
      imageId: row.image_id,
      inspectionId: row.inspection_id,
      inspectionType: row.inspection_type,
      category: row.category,
      generatedFileName: normalizeNullableText(row.generated_file_name),
      originalFileName: normalizeNullableText(row.original_file_name),
      createdAt: row.created_at ?? null,
      archivedAt: row.archived_at ?? null,
      eligible: reasons.length === 0,
      reasons,
    };
  });

  return {
    bookingId: context.booking_id,
    bookingPublicId: normalizeText(context.booking_public_id) || context.booking_id,
    vehicleId: context.vehicle_id,
    policy,
    candidates,
    eligibleCount: candidates.filter((candidate: BookingVehicleInspectionImageArchiveCandidate) => candidate.eligible).length,
    ineligibleCount: candidates.filter((candidate: BookingVehicleInspectionImageArchiveCandidate) => !candidate.eligible).length,
  };
}

export async function archiveEligibleBookingVehicleInspectionImages(
  bookingId: string,
  input: ArchiveEligibleBookingVehicleInspectionImagesInput = {},
  deps: ArchiveEligibleBookingVehicleInspectionImagesDeps = {},
): Promise<ArchiveEligibleBookingVehicleInspectionImagesResult | null> {
  const query = deps.query ?? dbQuery;
  const writeAudit =
    deps.writeAudit ??
    (async (auditInput: {
      userId?: string | null;
      action: string;
      entityType: string;
      entityId?: string;
      details?: Record<string, unknown>;
    }) => {
      const { writeAuditLog } = await import("@/lib/audit");
      await writeAuditLog(auditInput);
    });

  const evaluation = await evaluateBookingVehicleInspectionImageArchiveCandidates(
    bookingId,
    { imageIds: input.imageIds ?? [] },
    {
      query,
      loadInspections: deps.loadInspections,
      now: deps.now,
    },
  );
  if (!evaluation) return null;

  const archiveReason =
    normalizeNullableText(input.archiveReason, 500) ??
    "Eligible clean-history inspection image archive";
  const archiveSource =
    normalizeNullableText(input.archiveSource, 120) ?? "booking_inspection_retention";

  const results: BookingVehicleInspectionImageArchiveActionResult[] = [];
  let archivedCount = 0;
  let skippedCount = 0;

  for (const candidate of evaluation.candidates) {
    if (!candidate.eligible) {
      results.push({
        ...candidate,
        outcome: "SKIPPED",
        archivedAt: candidate.archivedAt,
      });
      skippedCount += 1;
      continue;
    }

    const archivedAt = new Date().toISOString();
    const archived = await archiveBookingVehicleInspectionImage(
      bookingId,
      {
        imageId: candidate.imageId,
        inspectionId: candidate.inspectionId,
        inspectionType: candidate.inspectionType,
      },
      { query },
    );

    if (!archived) {
      results.push({
        ...candidate,
        outcome: "SKIPPED",
        archivedAt: null,
      });
      skippedCount += 1;
      continue;
    }

    await writeAudit({
      userId: input.actorUserId ?? null,
      action: "BOOKING_VEHICLE_INSPECTION_IMAGE_ARCHIVED",
      entityType: "booking_vehicle_inspection_image",
      entityId: candidate.imageId,
      details: {
        bookingId: evaluation.bookingId,
        bookingPublicId: evaluation.bookingPublicId,
        vehicleId: evaluation.vehicleId,
        inspectionId: candidate.inspectionId,
        inspectionType: candidate.inspectionType,
        imageId: candidate.imageId,
        category: candidate.category,
        generatedFileName: candidate.generatedFileName,
        originalFileName: candidate.originalFileName,
        archiveReason,
        archiveSource,
        archivedAt,
        policy: evaluation.policy,
      },
    });

    results.push({
      ...candidate,
      outcome: "ARCHIVED",
      archivedAt,
    });
    archivedCount += 1;
  }

  return {
    bookingId: evaluation.bookingId,
    bookingPublicId: evaluation.bookingPublicId,
    vehicleId: evaluation.vehicleId,
    archiveReason,
    archiveSource,
    policy: evaluation.policy,
    eligibleCount: evaluation.eligibleCount,
    ineligibleCount: evaluation.ineligibleCount,
    archivedCount,
    skippedCount,
    results,
  };
}

export async function hasCompletedBookingVehicleInspection(
  bookingId: string,
  inspectionType: BookingVehicleInspectionType,
  deps: HasCompletedBookingVehicleInspectionDeps = {},
) {
  const query = deps.query ?? dbQuery;
  const result = await query<{ id: string }>(
    "select id from booking_vehicle_inspections where booking_id = $1::uuid and inspection_type = $2::text and status = 'COMPLETED' limit 1",
    [bookingId, inspectionType],
  );
  return result.rowCount > 0;
}

export async function syncVehicleOdometerFromInspectionCompletion(
  input: {
    vehicleId: string;
    odometerValue: number;
    odometerUnit: string | null;
  },
  deps: SyncVehicleOdometerDeps = {},
) {
  const query = deps.query ?? dbQuery;
  await query(
    `insert into vehicle_profiles (vehicle_id, odometer_value, odometer_unit)
     values ($1::uuid, $2::int, $3)
     on conflict (vehicle_id) do update
       set odometer_value = excluded.odometer_value,
           odometer_unit = excluded.odometer_unit,
           updated_at = now()`,
    [input.vehicleId, input.odometerValue, normalizeNullableText(input.odometerUnit) ?? "KM"],
  );
}

const runDbTransaction: RunDbTransaction = async (callback) => {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const query: DbQueryFn = async (text, params = []) => {
      const result = await client.query(text, params);
      return result as typeof result & { rows: unknown[] };
    };
    const result = await callback(query);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

export async function correctBookingVehicleInspectionOdometer(
  bookingId: string,
  input: CorrectBookingVehicleInspectionOdometerInput,
  deps: CorrectBookingVehicleInspectionOdometerDeps = {},
): Promise<CorrectBookingVehicleInspectionOdometerResult> {
  const runInTransaction = deps.runInTransaction ?? runDbTransaction;

  return runInTransaction(async (query) => {
    const targetResult = await query<{
      inspection_id: string;
      booking_id: string;
      booking_public_id: string | null;
      vehicle_id: string;
      inspection_type: BookingVehicleInspectionType;
      status: BookingVehicleInspectionRecordStatus;
      odometer_value: number | null;
      odometer_unit: string | null;
      vehicle_odometer_value: number | null;
      vehicle_odometer_unit: string | null;
    }>(
      `select
         i.id as inspection_id,
         i.booking_id,
         b.public_id as booking_public_id,
         i.vehicle_id,
         i.inspection_type,
         i.status,
         i.odometer_value,
         i.odometer_unit,
         vp.odometer_value as vehicle_odometer_value,
         vp.odometer_unit as vehicle_odometer_unit
       from booking_vehicle_inspections i
       join bookings b
         on b.id = i.booking_id
       left join vehicle_profiles vp
         on vp.vehicle_id = i.vehicle_id
       where i.booking_id = $1::uuid
         and i.id = $2::uuid
         and i.inspection_type = $3::text
       limit 1`,
      [bookingId, input.inspectionId, input.inspectionType],
    );

    const target = targetResult.rows[0];
    if (!target) {
      return { ok: false, status: 404, error: "Inspection not found for this booking." };
    }

    if (target.status !== "COMPLETED") {
      return {
        ok: false,
        status: 400,
        error: "Only completed inspections can be corrected.",
      };
    }

    if (!Number.isInteger(input.correctedOdometerValue) || input.correctedOdometerValue < 0) {
      return {
        ok: false,
        status: 400,
        error: "Corrected odometer must be a non-negative whole number.",
      };
    }

    if (input.correctedOdometerValue === target.odometer_value) {
      return {
        ok: false,
        status: 400,
        error: "Corrected odometer must be different from the current inspection odometer.",
      };
    }

    const counterpartType =
      target.inspection_type === "PICKUP" ? "RETURN" : "PICKUP";
    const counterpartResult = await query<{
      inspection_type: BookingVehicleInspectionType;
      odometer_value: number | null;
      odometer_unit: string | null;
    }>(
      `select inspection_type, odometer_value, odometer_unit
       from booking_vehicle_inspections
       where booking_id = $1::uuid
         and inspection_type = $2::text
         and status = 'COMPLETED'
       limit 1`,
      [bookingId, counterpartType],
    );
    const counterpart = counterpartResult.rows[0] ?? null;

    if (
      target.inspection_type === "RETURN" &&
      counterpart?.inspection_type === "PICKUP" &&
      counterpart.odometer_value !== null &&
      input.correctedOdometerValue < counterpart.odometer_value
    ) {
      return {
        ok: false,
        status: 400,
        error: `Return odometer cannot be lower than the completed pickup odometer of ${formatBookingVehicleInspectionOdometer(
          counterpart.odometer_value,
          counterpart.odometer_unit,
        )}.`,
      };
    }

    if (
      target.inspection_type === "PICKUP" &&
      counterpart?.inspection_type === "RETURN" &&
      counterpart.odometer_value !== null &&
      input.correctedOdometerValue > counterpart.odometer_value
    ) {
      return {
        ok: false,
        status: 400,
        error: `Pickup odometer cannot be corrected above the completed return odometer of ${formatBookingVehicleInspectionOdometer(
          counterpart.odometer_value,
          counterpart.odometer_unit,
        )}.`,
      };
    }

    const correctedAt = new Date().toISOString();
    const effectiveOdometerUnit =
      normalizeNullableText(target.odometer_unit) ??
      normalizeNullableText(target.vehicle_odometer_unit) ??
      "KM";

    await query(
      `update booking_vehicle_inspections
       set odometer_value = $2::int,
           odometer_corrected_from_value = odometer_value,
           odometer_correction_reason = $3,
           odometer_corrected_by_user_id = $4::uuid,
           odometer_corrected_at = $5::timestamptz,
           updated_at = now()
       where id = $1::uuid`,
      [
        target.inspection_id,
        input.correctedOdometerValue,
        input.correctionReason,
        input.correctedByUserId,
        correctedAt,
      ],
    );

    await query(
      `insert into vehicle_profiles (vehicle_id, odometer_value, odometer_unit)
       values ($1::uuid, $2::int, $3)
       on conflict (vehicle_id) do update
         set odometer_value = excluded.odometer_value,
             odometer_unit = excluded.odometer_unit,
             updated_at = now()`,
      [target.vehicle_id, input.correctedOdometerValue, effectiveOdometerUnit],
    );

    return {
      ok: true,
      correction: {
        bookingId: target.booking_id,
        bookingPublicId: normalizeText(target.booking_public_id) || target.booking_id,
        vehicleId: target.vehicle_id,
        inspectionId: target.inspection_id,
        inspectionType: target.inspection_type,
        previousOdometerValue: target.odometer_value,
        correctedOdometerValue: input.correctedOdometerValue,
        odometerUnit: effectiveOdometerUnit,
        vehiclePreviousOdometerValue: target.vehicle_odometer_value,
        vehiclePreviousOdometerUnit: target.vehicle_odometer_unit,
        correctionReason: input.correctionReason,
        correctedByUserId: input.correctedByUserId,
        correctedAt,
      },
    };
  });
}

async function loadBookingVehicleInspectionAlertContext(
  bookingId: string,
  query: DbQueryFn,
): Promise<BookingVehicleInspectionAlertContext | null> {
  const result = await query<{
    booking_id: string;
    booking_public_id: string | null;
    customer_name: string | null;
    customer_email: string | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
  }>(
    `select
       b.id as booking_id,
       b.public_id as booking_public_id,
       c.full_name as customer_name,
       c.email as customer_email,
       v.make as vehicle_make,
       v.model as vehicle_model,
       v.year as vehicle_year
     from bookings b
     join customers c
       on c.id = b.customer_id
     join vehicles v
       on v.id = b.vehicle_id
     where b.id = $1::uuid
     limit 1`,
    [bookingId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const vehicleParts = [
    row.vehicle_year ? String(row.vehicle_year) : "",
    normalizeText(row.vehicle_make),
    normalizeText(row.vehicle_model),
  ].filter(Boolean);

  return {
    bookingId: row.booking_id,
    bookingPublicId: normalizeText(row.booking_public_id) || row.booking_id,
    customerName: normalizeNullableText(row.customer_name),
    customerEmail: normalizeNullableText(row.customer_email),
    vehicleLabel: vehicleParts.length ? vehicleParts.join(" ") : null,
  };
}

async function hasExistingInspectionIssueAudit(
  bookingId: string,
  action: string,
  inspectionId: string,
  query: DbQueryFn,
) {
  const result = await query<{ id: string }>(
    `select id
     from audit_logs
     where action = $1
       and entity_type = 'booking'
       and entity_id = $2::uuid
       and coalesce(details_json->>'inspectionId', '') = $3
     limit 1`,
    [action, bookingId, inspectionId],
  );
  return result.rowCount > 0;
}

function buildBookingVehicleInspectionIssueMessage(input: {
  context: BookingVehicleInspectionAlertContext;
  inspections: LoadedBookingVehicleInspections;
  issueType: "FUEL_MISMATCH" | "RETURN_DAMAGE";
}) {
  const lines = [
    `Booking ${input.context.bookingPublicId} vehicle inspection warning`,
    "",
    `Issue: ${
      input.issueType === "FUEL_MISMATCH"
        ? "Return fuel is lower than pickup fuel"
        : "Return inspection reports damage"
    }`,
    input.context.customerName ? `Customer: ${input.context.customerName}` : null,
    input.context.customerEmail ? `Customer email: ${input.context.customerEmail}` : null,
    input.context.vehicleLabel ? `Vehicle: ${input.context.vehicleLabel}` : null,
    input.issueType === "FUEL_MISMATCH"
      ? `Pickup fuel: ${input.inspections.pickup.fuelLevelDisplay}`
      : null,
    input.issueType === "FUEL_MISMATCH"
      ? `Return fuel: ${input.inspections.returnInspection.fuelLevelDisplay}`
      : null,
    input.issueType === "RETURN_DAMAGE"
      ? `Damage present: ${input.inspections.returnInspection.damageDisplay}`
      : null,
    input.inspections.returnInspection.recordedByDisplay
      ? `Recorded by: ${input.inspections.returnInspection.recordedByDisplay}`
      : null,
    input.inspections.returnInspection.recordedAt
      ? `Recorded at: ${input.inspections.returnInspection.recordedAt}`
      : null,
  ].filter(Boolean);

  return lines.join("\n");
}

function buildBookingVehicleInspectionIssueEmailSubject(input: {
  context: BookingVehicleInspectionAlertContext;
  issueType: "FUEL_MISMATCH" | "RETURN_DAMAGE";
}) {
  return input.issueType === "FUEL_MISMATCH"
    ? `[Inspection] Fuel mismatch — ${input.context.bookingPublicId}`
    : `[Inspection] Damage reported — ${input.context.bookingPublicId}`;
}

function buildBookingVehicleInspectionIssueEmailHtml(input: {
  context: BookingVehicleInspectionAlertContext;
  inspections: LoadedBookingVehicleInspections;
  issueType: "FUEL_MISMATCH" | "RETURN_DAMAGE";
}) {
  const bookingLink = `${process.env.SITE_URL ?? "http://localhost:3000"}/admin/bookings/${input.context.bookingId}`;
  const issueSummary =
    input.issueType === "FUEL_MISMATCH"
      ? "Return fuel is lower than pickup fuel."
      : "Return inspection reports damage.";

  return `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2>Vehicle inspection warning</h2>
      <p><strong>Booking:</strong> ${input.context.bookingPublicId}</p>
      <p><strong>Issue:</strong> ${issueSummary}</p>
      ${input.context.customerName ? `<p><strong>Customer:</strong> ${input.context.customerName}</p>` : ""}
      ${input.context.customerEmail ? `<p><strong>Customer email:</strong> ${input.context.customerEmail}</p>` : ""}
      ${input.context.vehicleLabel ? `<p><strong>Vehicle:</strong> ${input.context.vehicleLabel}</p>` : ""}
      ${
        input.issueType === "FUEL_MISMATCH"
          ? `<p><strong>Pickup fuel:</strong> ${input.inspections.pickup.fuelLevelDisplay}<br /><strong>Return fuel:</strong> ${input.inspections.returnInspection.fuelLevelDisplay}</p>`
          : `<p><strong>Damage present:</strong> ${input.inspections.returnInspection.damageDisplay}</p>`
      }
      ${
        input.inspections.returnInspection.recordedByDisplay
          ? `<p><strong>Recorded by:</strong> ${input.inspections.returnInspection.recordedByDisplay}</p>`
          : ""
      }
      ${
        input.inspections.returnInspection.recordedAt
          ? `<p><strong>Recorded at:</strong> ${input.inspections.returnInspection.recordedAt}</p>`
          : ""
      }
      <p style="margin-top:16px;">
        <a href="${bookingLink}" style="background:#1f2d4d; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">Open Booking</a>
      </p>
      <p style="font-size:12px; color:#64748b;">This is an automated operational warning.</p>
    </div>
  `;
}

export async function processBookingVehicleInspectionIssues(
  bookingId: string,
  inspections: LoadedBookingVehicleInspections,
  deps: ProcessBookingVehicleInspectionIssuesDeps = {},
) {
  const query = deps.query ?? dbQuery;
  const loadSettings = deps.loadSettings ?? loadAdminSettings;
  const resolveOperationalRouting =
    deps.resolveOperationalRouting ??
    ((settings, options) => loadOperationalNotificationRoutingSummary(settings, { query, ...options }));
  const insertAdminNotification =
    deps.insertAdminNotification ??
    (async (input: { recipientEmail: string; message: string }) => {
      const row = await insertMailboxMessage(query, {
        name: "Vehicle inspection warning",
        email: input.recipientEmail,
        message: input.message,
        source: "booking_inspection",
        subject: `Vehicle inspection warning for ${context?.bookingPublicId ?? "booking"}`,
        displayName: context?.bookingPublicId
          ? `Vehicle inspection alert · ${context.bookingPublicId}`
          : "Vehicle inspection warning",
        displayEmail: input.recipientEmail ? `Recipient: ${input.recipientEmail}` : "Internal alert",
        messageType: "inspection_alert",
        priority: "high",
        relatedEntityType: "booking",
        relatedEntityId: bookingId,
        relatedEntityPublicId: context?.bookingPublicId ?? null,
        notificationEligible: true,
        metadataJson: {
          inspectionType: "return",
        },
      });
      return row ? { id: row.id } : null;
    });
  const writeAudit =
    deps.writeAudit ??
    (async (input: {
      userId?: string | null;
      action: string;
      entityType: string;
      entityId?: string;
      details?: Record<string, unknown>;
    }) => {
      const { writeAuditLog } = await import("@/lib/audit");
      await writeAuditLog(input);
    });
  const sendWarningEmail = deps.sendWarningEmail ?? sendOperationalAlertEmail;
  const acquireDedupe = deps.acquireDedupe ?? tryAcquireDedupe;
  const recordDedupeResult = deps.recordDedupeResult ?? markDedupeResult;

  const issueFlags = getBookingVehicleInspectionIssueFlags(inspections);
  const returnInspectionId = inspections.returnInspection.inspectionId;

  if (!issueFlags.warnings.length || !returnInspectionId) {
    return { fuelMismatchCreated: false, returnDamageCreated: false };
  }

  const context = await loadBookingVehicleInspectionAlertContext(bookingId, query);
  if (!context) {
    return { fuelMismatchCreated: false, returnDamageCreated: false };
  }

  const { settings } = await loadSettings();
  const operationalRouting = await resolveOperationalRouting(settings);

  let fuelMismatchCreated = false;
  let returnDamageCreated = false;
  const issues = [
    issueFlags.hasFuelMismatch
      ? {
          issueType: "FUEL_MISMATCH" as const,
          action: "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_ALERTED",
        }
      : null,
    issueFlags.hasReturnDamage
      ? {
          issueType: "RETURN_DAMAGE" as const,
          action: "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED",
        }
      : null,
  ].filter(Boolean);

  for (const issue of issues) {
    if (!issue) continue;

    const alreadyExists = await hasExistingInspectionIssueAudit(
      bookingId,
      issue.action,
      returnInspectionId,
      query,
    );
    if (alreadyExists) continue;

    const message = buildBookingVehicleInspectionIssueMessage({
      context,
      inspections,
      issueType: issue.issueType,
    });
    const notification = await insertAdminNotification({
      recipientEmail: context.customerEmail ?? "booking-inspection@internal.local",
      message,
    });

    await writeAudit({
      userId: deps.actorUserId ?? null,
      action: issue.action,
      entityType: "booking",
      entityId: bookingId,
      details: {
        bookingPublicId: context.bookingPublicId,
        customerName: context.customerName,
        customerEmail: context.customerEmail,
        vehicleLabel: context.vehicleLabel,
        issueType: issue.issueType,
        inspectionId: returnInspectionId,
        inspectionType: "RETURN",
        pickupFuelLevelEighths: inspections.pickup.fuelLevelEighths,
        pickupFuelDisplay: inspections.pickup.fuelLevelDisplay,
        returnFuelLevelEighths: inspections.returnInspection.fuelLevelEighths,
        returnFuelDisplay: inspections.returnInspection.fuelLevelDisplay,
        damagePresent: inspections.returnInspection.damagePresent,
        recordedByUserId: inspections.returnInspection.recordedByUserId,
        recordedByDisplay: inspections.returnInspection.recordedByDisplay,
        recordedAt: inspections.returnInspection.recordedAt,
        notificationId: notification?.id ?? null,
        emailWarningEnabled: settings.sendVehicleInspectionWarningEmails,
        emailRecipients: operationalRouting.effectiveRecipients,
        emailUsesFallback: operationalRouting.usesFallback,
      },
    });

    if (settings.sendVehicleInspectionWarningEmails && operationalRouting.effectiveRecipients.length > 0) {
      const recipientSetHash = createHash("sha1")
        .update(operationalRouting.effectiveRecipients.join(","))
        .digest("hex");
      const dedupeKey = computeDedupeKey({
        entityType: "booking",
        entityId: bookingId,
        eventType: `BOOKING_VEHICLE_INSPECTION_${issue.issueType}_EMAIL`,
        extra: {
          inspectionId: returnInspectionId,
          recipientSetHash,
        },
      });

      const dedupe = await acquireDedupe(
        {
          dedupeKey,
          entityType: "booking",
          entityId: bookingId,
          eventType: `BOOKING_VEHICLE_INSPECTION_${issue.issueType}_EMAIL`,
          provider: "resend",
        },
        query,
      );

      if (dedupe.acquired) {
        const emailResult = await sendWarningEmail({
          recipientEmails: operationalRouting.effectiveRecipients,
          subject: buildBookingVehicleInspectionIssueEmailSubject({
            context,
            issueType: issue.issueType,
          }),
          html: buildBookingVehicleInspectionIssueEmailHtml({
            context,
            inspections,
            issueType: issue.issueType,
          }),
        });

        await recordDedupeResult(
          {
            dedupeKey,
            status: emailResult.ok ? "SENT" : emailResult.skipped ? "SKIPPED" : "FAILED",
            provider: "resend",
            providerMessageId: emailResult.providerMessageId ?? null,
            error: emailResult.ok ? null : emailResult.error ?? "Delivery failed",
          },
          query,
        );
      }
    }

    if (issue.issueType === "FUEL_MISMATCH") {
      fuelMismatchCreated = true;
    } else {
      returnDamageCreated = true;
    }
  }

  return { fuelMismatchCreated, returnDamageCreated };
}
