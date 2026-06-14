"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { openUploadcareImagesDialog } from "@/components/admin/UploadcareImagesInput";
import { MediaActivityPanel } from "@/components/admin/MediaActivityPanel";
import { buttonStyles } from "@/components/ui/Button";
import {
  getAdminBookingLifecycleEligibility,
  runAdminBookingLifecycleAction,
  type AdminBookingLifecycleAction,
} from "@/lib/bookings/adminBookingLifecycleClient";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import {
  BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES,
  BOOKING_VEHICLE_INSPECTION_FUEL_LEVELS,
  formatBookingVehicleInspectionFuelLevel,
  formatBookingVehicleInspectionImageCategory,
  formatBookingVehicleInspectionOdometer,
  getBookingVehicleInspectionIssueFlags,
  getBookingVehicleInspectionOdometerPrefill,
  isPickupInspectionEditableForStatus,
  isReturnInspectionEditableForStatus,
  isReturnInspectionAvailableForStatus,
  type BookingVehicleInspectionImageCategory,
  type BookingVehicleInspectionImageSummary,
  type BookingVehicleInspectionWarning,
  type BookingVehicleInspectionSummary,
  type LoadedBookingVehicleInspections,
} from "@/lib/bookings/vehicleInspectionShared";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { getUploadcareClientErrorMessage } from "@/lib/uploads/uploadcare-client";
import type { MediaAuditActivity } from "@/lib/uploads/mediaAudit";

type BookingVehicleInspectionPanelProps = {
  bookingId: string;
  bookingStatus: string;
  bookingPublicId: string;
  inspections: LoadedBookingVehicleInspections;
  mediaActivities?: MediaAuditActivity[];
  tablesUnavailable?: boolean;
  canCorrectOdometer?: boolean;
  isPaidInFull?: boolean;
  onInspectionCompleted?: (inspectionType: "PICKUP" | "RETURN") => void;
  onBookingLifecycleCompleted?: (action: "pickup" | "complete") => void;
};

type InspectionFormState = {
  odometerValue: string;
  odometerUnit: string;
  fuelLevelEighths: string;
  damagePresent: string;
  notes: string;
};

type CorrectionFormState = {
  odometerValue: string;
  reason: string;
};

type ImageUploadState = {
  category: BookingVehicleInspectionImageCategory;
  loading: boolean;
  operation: "idle" | "uploading" | "saving" | "deleting";
  error: string | null;
  message: string | null;
};

type InspectionSaveResult = {
  inspection: LoadedBookingVehicleInspections["pickup"];
  inspections: Pick<
    LoadedBookingVehicleInspections,
    "vehicleOdometerValue" | "vehicleOdometerUnit" | "pickup" | "returnInspection"
  >;
};

function getStatusBadgeClass(status: LoadedBookingVehicleInspections["pickup"]["displayStatus"]) {
  if (status === "COMPLETED") {
    return "border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  if (status === "IN_PROGRESS") {
    return "border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] text-[var(--ccr-status-accent-text)]";
  }
  return "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
}

function getWarningBadgeClass(severity: BookingVehicleInspectionWarning["severity"]) {
  if (severity === "danger") {
    return "border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  return "border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] text-[var(--ccr-status-accent-text)]";
}

function getAccessBadgeClass(kind: "editable" | "locked") {
  if (kind === "locked") {
    return "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
  }
  return "border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] text-[var(--ccr-status-accent-text)]";
}

function formatInspectionImageCountLabel(imageCount: number) {
  return imageCount === 1 ? "1 photo" : `${imageCount} photos`;
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--ccr-border)]/60 py-2 last:border-b-0 last:pb-0">
      <dt className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">{label}</dt>
      <dd className="text-right text-sm font-medium text-[var(--ccr-text)]">{value}</dd>
    </div>
  );
}

function buildCorrectionFormState(summary: BookingVehicleInspectionSummary): CorrectionFormState {
  return {
    odometerValue:
      summary.odometerValue !== null && Number.isFinite(summary.odometerValue)
        ? String(summary.odometerValue)
        : "",
    reason: "",
  };
}

function buildInspectionFormState(
  summary: BookingVehicleInspectionSummary,
  inspections: LoadedBookingVehicleInspections,
): InspectionFormState {
  const odometerPrefill = getBookingVehicleInspectionOdometerPrefill(summary, inspections);
  return {
    odometerValue:
      odometerPrefill.odometerValue !== null && Number.isFinite(odometerPrefill.odometerValue)
        ? String(odometerPrefill.odometerValue)
        : "",
    odometerUnit: odometerPrefill.odometerUnit,
    fuelLevelEighths:
      summary.fuelLevelEighths !== null && Number.isInteger(summary.fuelLevelEighths)
        ? String(summary.fuelLevelEighths)
        : "",
    damagePresent:
      typeof summary.damagePresent === "boolean" ? String(summary.damagePresent) : "",
    notes: summary.notes ?? "",
  };
}

function createImageUploadState(): ImageUploadState {
  return {
    category: "EXTERIOR",
    loading: false,
    operation: "idle",
    error: null,
    message: null,
  };
}

function InspectionImagesSection({
  bookingPublicId,
  summary,
  editable,
  uploadState,
  onUploadStateChange,
  onUpload,
  onDelete,
}: {
  bookingPublicId: string;
  summary: BookingVehicleInspectionSummary;
  editable: boolean;
  uploadState: ImageUploadState;
  onUploadStateChange: (updater: (current: ImageUploadState) => ImageUploadState) => void;
  onUpload: () => void;
  onDelete: (image: BookingVehicleInspectionImageSummary) => void;
}) {
  const [failedPreviewIds, setFailedPreviewIds] = useState<string[]>([]);
  const needsDraftBeforeUpload = editable && !summary.inspectionId;
  const emptyStateText = needsDraftBeforeUpload
    ? "Uploading the first image will save this inspection as a draft automatically. Then you can add odometer, fuel, exterior, or damage photos."
    : editable
      ? "No images uploaded yet. Add supporting inspection photos before you complete this step."
      : "No inspection photos were uploaded for this locked inspection.";

  return (
    <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--ccr-text)]">Inspection images</p>
          <p className="text-xs text-[var(--ccr-muted)]">
            Images are tagged with {bookingPublicId}, inspection type, and category metadata.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
            {formatInspectionImageCountLabel(summary.imageCount)}
          </span>
          <label className="space-y-1">
            <span className="sr-only">Image category</span>
            <select
              value={uploadState.category}
              onChange={(event) =>
                onUploadStateChange((current) => ({
                  ...current,
                  category: event.target.value as BookingVehicleInspectionImageCategory,
                }))
              }
              disabled={!editable || uploadState.loading}
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {BOOKING_VEHICLE_INSPECTION_IMAGE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {formatBookingVehicleInspectionImageCategory(category)}
                </option>
              ))}
            </select>
          </label>
            <button
              type="button"
              disabled={!editable || uploadState.loading}
              onClick={onUpload}
              className={buttonStyles({ variant: "secondary", size: "sm" })}
            >
              {uploadState.loading
                ? uploadState.operation === "saving"
                  ? "Verifying & saving..."
                  : uploadState.operation === "deleting"
                    ? "Removing..."
                    : "Uploading..."
                : needsDraftBeforeUpload
                  ? "Save draft & upload selected category"
                  : "Upload selected category"}
            </button>
        </div>
      </div>

      {needsDraftBeforeUpload ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-muted)]">
          The first upload will save this inspection as a draft automatically.
        </div>
      ) : null}

      {!editable ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-muted)]">
          Inspection images are read-only while this inspection is locked.
        </div>
      ) : null}

      {uploadState.loading ? (
        <div className="mt-3 rounded-xl border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] px-3 py-2 text-sm text-[var(--ccr-status-accent-text)]">
          {uploadState.operation === "saving"
            ? "Upload complete. Verifying the file and saving it to this inspection."
            : uploadState.operation === "deleting"
              ? "Removing the image and checking whether the Uploadcare file is still referenced."
              : "Uploading selected files to Uploadcare."}
        </div>
      ) : null}

      {uploadState.message ? (
        <div className="mt-3 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-sm text-[var(--ccr-status-success-text)]">
          {uploadState.message}
        </div>
      ) : null}

      {uploadState.error ? (
        <div className="mt-3 rounded-xl border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-sm text-[var(--ccr-status-danger-text)]">
          {uploadState.error}
        </div>
      ) : null}

      {summary.images.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {summary.images.map((image) => (
            <article
              key={image.id}
              className="min-w-0 overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
            >
              {image.previewUrl && !failedPreviewIds.includes(image.id) ? (
                <a href={image.previewUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.previewUrl}
                    alt={image.generatedFileName ?? image.label ?? "Inspection image"}
                    onError={() =>
                      setFailedPreviewIds((current) =>
                        current.includes(image.id) ? current : [...current, image.id],
                      )
                    }
                    className="h-28 w-full object-cover sm:h-32"
                  />
                </a>
              ) : (
                <div className="flex h-28 items-center justify-center bg-[var(--ccr-surface-soft)] px-3 text-center text-sm text-[var(--ccr-muted)] sm:h-32">
                  Preview unavailable
                </div>
              )}
              <div className="space-y-2.5 p-3">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span
                    title={`Image category: ${image.categoryLabel}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-text)]"
                  >
                    {image.categoryLabel}
                    <ChevronDown aria-hidden="true" size={12} />
                  </span>
                  <span className="truncate text-xs text-[var(--ccr-muted)]">
                    {bookingPublicId}
                  </span>
                </div>
                <div className="min-w-0 space-y-1">
                  <p
                    title={image.generatedFileName ?? image.originalFileName ?? "Inspection image"}
                    className="truncate text-sm font-medium text-[var(--ccr-text)]"
                  >
                    {image.generatedFileName ?? image.originalFileName ?? "Inspection image"}
                  </p>
                  <p className="text-xs text-[var(--ccr-muted)]">
                    {image.createdAt ? <DateTimeInline value={image.createdAt} /> : "Uploaded"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {image.previewUrl ? (
                    <a
                      href={image.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonStyles({
                        variant: "secondary",
                        size: "xs",
                        className: "flex-1 sm:flex-none",
                      })}
                    >
                      Open
                    </a>
                  ) : null}
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => onDelete(image)}
                      className={buttonStyles({
                        variant: "secondary",
                        size: "xs",
                        className: "flex-1 sm:flex-none",
                      })}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--ccr-muted)]">{emptyStateText}</p>
      )}
    </div>
  );
}

function InspectionSummaryDetails({
  summary,
}: {
  summary: BookingVehicleInspectionSummary;
}) {
  return (
    <dl className="space-y-1 border-t border-[var(--ccr-border)] pt-4">
      <SummaryRow label="Recorded by" value={summary.recordedByDisplay ?? "Not recorded yet"} />
      <SummaryRow
        label="Recorded at"
        value={summary.recordedAt ? <DateTimeInline value={summary.recordedAt} /> : "Not recorded yet"}
      />
      <SummaryRow
        label="Odometer"
        value={
          summary.odometerValue !== null
            ? `${summary.odometerValue.toLocaleString()}${summary.odometerUnit ? ` ${summary.odometerUnit}` : ""}`
            : "Not recorded"
        }
      />
      <SummaryRow label="Fuel" value={summary.fuelLevelDisplay} />
      <SummaryRow label="Damage" value={summary.damageDisplay} />
      <SummaryRow label="Images" value={formatInspectionImageCountLabel(summary.imageCount)} />
      <SummaryRow label="Notes" value={summary.noteSnippet ?? "No notes recorded yet."} />
      {summary.hasOdometerCorrection ? (
        <>
          <SummaryRow
            label="Correction"
            value={
              <span className="inline-flex items-center justify-end gap-1">
                <span>
                  {formatBookingVehicleInspectionOdometer(
                    summary.odometerCorrectedFromValue,
                    summary.odometerUnit,
                  )}
                </span>
                <DateRangeArrow size={14} className="mx-0" />
                <span>
                  {formatBookingVehicleInspectionOdometer(
                    summary.odometerValue,
                    summary.odometerUnit,
                  )}
                </span>
              </span>
            }
          />
          <SummaryRow
            label="Corrected by"
            value={summary.odometerCorrectedByDisplay ?? "Not recorded"}
          />
          <SummaryRow
            label="Corrected at"
            value={
              summary.odometerCorrectedAt ? (
                <DateTimeInline value={summary.odometerCorrectedAt} />
              ) : (
                "Not recorded"
              )
            }
          />
          <SummaryRow
            label="Correction reason"
            value={summary.odometerCorrectionReason ?? "Not recorded"}
          />
        </>
      ) : null}
    </dl>
  );
}

function InspectionFormFields({
  form,
  onChange,
  editable,
}: {
  form: InspectionFormState;
  onChange: (updater: (current: InspectionFormState) => InspectionFormState) => void;
  editable: boolean;
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Odometer value
          </span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={form.odometerValue}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                odometerValue: event.target.value,
              }))
            }
            disabled={!editable}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Odometer unit
          </span>
          <select
            value={form.odometerUnit}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                odometerUnit: event.target.value,
              }))
            }
            disabled={!editable}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="KM">KM</option>
            <option value="MI">MI</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Fuel level
          </span>
          <select
            value={form.fuelLevelEighths}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                fuelLevelEighths: event.target.value,
              }))
            }
            disabled={!editable}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="">Select fuel level</option>
            {BOOKING_VEHICLE_INSPECTION_FUEL_LEVELS.map((value) => (
              <option key={value} value={String(value)}>
                {formatBookingVehicleInspectionFuelLevel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Damage present
          </span>
          <select
            value={form.damagePresent}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                damagePresent: event.target.value,
              }))
            }
            disabled={!editable}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            <option value="">Select damage status</option>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      </div>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Notes
        </span>
        <textarea
          value={form.notes}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          disabled={!editable}
          rows={4}
          className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
    </div>
  );
}

export function BookingVehicleInspectionPanel({
  bookingId,
  bookingStatus,
  bookingPublicId,
  inspections,
  mediaActivities = [],
  tablesUnavailable = false,
  canCorrectOdometer = false,
  isPaidInFull = false,
  onInspectionCompleted,
  onBookingLifecycleCompleted,
}: BookingVehicleInspectionPanelProps) {
  const [pickupSummary, setPickupSummary] = useState(() => inspections.pickup);
  const [vehicleOdometerValue, setVehicleOdometerValue] = useState<number | null>(
    () => inspections.vehicleOdometerValue,
  );
  const [vehicleOdometerUnit, setVehicleOdometerUnit] = useState<string | null>(
    () => inspections.vehicleOdometerUnit,
  );
  const [pickupForm, setPickupForm] = useState<InspectionFormState>(() =>
    buildInspectionFormState(inspections.pickup, inspections),
  );
  const [pickupMessage, setPickupMessage] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [pickupLoading, setPickupLoading] = useState<"draft" | "complete" | null>(null);
  const [pickupCorrectionOpen, setPickupCorrectionOpen] = useState(false);
  const [pickupCorrectionForm, setPickupCorrectionForm] = useState<CorrectionFormState>(() =>
    buildCorrectionFormState(inspections.pickup),
  );
  const [pickupCorrectionMessage, setPickupCorrectionMessage] = useState<string | null>(null);
  const [pickupCorrectionError, setPickupCorrectionError] = useState<string | null>(null);
  const [pickupCorrectionLoading, setPickupCorrectionLoading] = useState(false);
  const [pickupImageUpload, setPickupImageUpload] = useState<ImageUploadState>(() =>
    createImageUploadState(),
  );
  const [returnSummary, setReturnSummary] = useState(() => inspections.returnInspection);
  const [returnForm, setReturnForm] = useState<InspectionFormState>(() =>
    buildInspectionFormState(inspections.returnInspection, inspections),
  );
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnLoading, setReturnLoading] = useState<"draft" | "complete" | null>(null);
  const [returnCorrectionOpen, setReturnCorrectionOpen] = useState(false);
  const [returnCorrectionForm, setReturnCorrectionForm] = useState<CorrectionFormState>(() =>
    buildCorrectionFormState(inspections.returnInspection),
  );
  const [returnCorrectionMessage, setReturnCorrectionMessage] = useState<string | null>(null);
  const [returnCorrectionError, setReturnCorrectionError] = useState<string | null>(null);
  const [returnCorrectionLoading, setReturnCorrectionLoading] = useState(false);
  const [returnImageUpload, setReturnImageUpload] = useState<ImageUploadState>(() =>
    createImageUploadState(),
  );
  const [lifecycleLoading, setLifecycleLoading] = useState<
    Extract<AdminBookingLifecycleAction, "pickup" | "complete"> | null
  >(null);

  const pickupEditable =
    !tablesUnavailable && isPickupInspectionEditableForStatus(bookingStatus);
  const returnInspectionEnabled = !tablesUnavailable && isReturnInspectionAvailableForStatus(bookingStatus);
  const returnEditable =
    !tablesUnavailable && isReturnInspectionEditableForStatus(bookingStatus);
  const {
    canPickup: canConfirmPickup,
    canComplete: canCompleteBooking,
    pickupDisabledReason: confirmPickupDisabledReason,
    completeDisabledReason: completeBookingDisabledReason,
  } = getAdminBookingLifecycleEligibility({
    bookingStatus,
    isPaidInFull,
    isPickupInspectionComplete: pickupSummary.recordStatus === "COMPLETED",
    isReturnInspectionComplete: returnSummary.recordStatus === "COMPLETED",
  });
  const currentInspections: LoadedBookingVehicleInspections = {
    bookingId,
    bookingPublicId,
    vehicleId: inspections.vehicleId,
    vehicleOdometerValue,
    vehicleOdometerUnit,
    pickup: pickupSummary,
    returnInspection: returnSummary,
  };
  const issueFlags = getBookingVehicleInspectionIssueFlags(currentInspections);
  function applyInspectionSet(
    nextInspections: Pick<
      LoadedBookingVehicleInspections,
      "vehicleOdometerValue" | "vehicleOdometerUnit" | "pickup" | "returnInspection"
    >,
  ) {
    const normalized: LoadedBookingVehicleInspections = {
      bookingId,
      bookingPublicId,
      vehicleId: inspections.vehicleId,
      vehicleOdometerValue: nextInspections.vehicleOdometerValue,
      vehicleOdometerUnit: nextInspections.vehicleOdometerUnit,
      pickup: nextInspections.pickup,
      returnInspection: nextInspections.returnInspection,
    };

    setVehicleOdometerValue(normalized.vehicleOdometerValue);
    setVehicleOdometerUnit(normalized.vehicleOdometerUnit);
    setPickupSummary(normalized.pickup);
    setReturnSummary(normalized.returnInspection);
    setPickupForm((current) =>
      pickupEditable || !normalized.pickup.inspectionId
        ? buildInspectionFormState(normalized.pickup, normalized)
        : current,
    );
    setReturnForm((current) =>
      returnEditable || !normalized.returnInspection.inspectionId
        ? buildInspectionFormState(normalized.returnInspection, normalized)
        : current,
    );
    setPickupCorrectionForm((current) =>
      pickupCorrectionOpen ? current : buildCorrectionFormState(normalized.pickup),
    );
    setReturnCorrectionForm((current) =>
      returnCorrectionOpen ? current : buildCorrectionFormState(normalized.returnInspection),
    );
  }

  async function saveInspection(
    inspectionType: "PICKUP" | "RETURN",
    status: "DRAFT" | "COMPLETED",
  ): Promise<InspectionSaveResult | null> {
    const isPickup = inspectionType === "PICKUP";
    const form = isPickup ? pickupForm : returnForm;
    const setMessage = isPickup ? setPickupMessage : setReturnMessage;
    const setError = isPickup ? setPickupError : setReturnError;
    const setLoading = isPickup ? setPickupLoading : setReturnLoading;
    const setSummary = isPickup ? setPickupSummary : setReturnSummary;
    const setForm = isPickup ? setPickupForm : setReturnForm;

    setMessage(null);
    setError(null);
    setLoading(status === "COMPLETED" ? "complete" : "draft");

    const csrfToken = await ensureCsrfToken();
    const odometerValue =
      form.odometerValue.trim() === "" ? null : Number(form.odometerValue.trim());
    const fuelLevelEighths =
      form.fuelLevelEighths.trim() === ""
        ? null
        : Number(form.fuelLevelEighths.trim());

    const response = await fetch(`/api/admin/bookings/${bookingId}/inspections`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        inspectionType,
        status,
        odometerValue,
        odometerUnit: form.odometerUnit,
        fuelLevelEighths,
        damagePresent:
          form.damagePresent.trim() === ""
            ? false
            : form.damagePresent === "true",
        notes: form.notes,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      inspection?: LoadedBookingVehicleInspections["pickup"];
      inspections?: Pick<
        LoadedBookingVehicleInspections,
        "vehicleOdometerValue" | "vehicleOdometerUnit" | "pickup" | "returnInspection"
      >;
    };
    setLoading(null);

    if (!response.ok || !payload.ok || !payload.inspection) {
      setError(payload.error ?? `Unable to save ${inspectionType.toLowerCase()} inspection.`);
      return null;
    }

    const nextInspectionSet = {
      vehicleOdometerValue: payload.inspections?.vehicleOdometerValue ?? vehicleOdometerValue,
      vehicleOdometerUnit: payload.inspections?.vehicleOdometerUnit ?? vehicleOdometerUnit,
      pickup: payload.inspections?.pickup ?? pickupSummary,
      returnInspection: payload.inspections?.returnInspection ?? returnSummary,
    };

    applyInspectionSet(nextInspectionSet);
    setSummary(payload.inspection);
    setForm(
      buildInspectionFormState(payload.inspection, {
        bookingId,
        bookingPublicId,
        vehicleId: inspections.vehicleId,
        ...nextInspectionSet,
      }),
    );
    setMessage(
      status === "COMPLETED"
        ? `${isPickup ? "Pickup" : "Return"} inspection completed.`
        : `${isPickup ? "Pickup" : "Return"} inspection draft saved.`,
    );
    if (status === "COMPLETED") {
      onInspectionCompleted?.(inspectionType);
    }
    return {
      inspection: payload.inspection,
      inspections: nextInspectionSet,
    };
  }

  async function runLifecycleAction(action: "pickup" | "complete") {
    const setMessage = action === "pickup" ? setPickupMessage : setReturnMessage;
    const setError = action === "pickup" ? setPickupError : setReturnError;

    setMessage(null);
    setError(null);
    setLifecycleLoading(action);

    const { response, data } = await runAdminBookingLifecycleAction({
      bookingId,
      action,
    });
    setLifecycleLoading(null);

    if (!response.ok) {
      setError(data.error ?? "Action failed.");
      return;
    }

    setMessage(
      data.message ??
        (action === "pickup"
          ? "Booking marked as picked up."
          : "Booking completed."),
    );
    onBookingLifecycleCompleted?.(action);
  }

  async function correctInspectionOdometer(inspectionType: "PICKUP" | "RETURN") {
    const isPickup = inspectionType === "PICKUP";
    const summary = isPickup ? pickupSummary : returnSummary;
    const correctionForm = isPickup ? pickupCorrectionForm : returnCorrectionForm;
    const setError = isPickup ? setPickupCorrectionError : setReturnCorrectionError;
    const setMessage = isPickup ? setPickupCorrectionMessage : setReturnCorrectionMessage;
    const setLoading = isPickup ? setPickupCorrectionLoading : setReturnCorrectionLoading;
    const setOpen = isPickup ? setPickupCorrectionOpen : setReturnCorrectionOpen;
    const setSummary = isPickup ? setPickupSummary : setReturnSummary;
    const setCorrectionForm = isPickup ? setPickupCorrectionForm : setReturnCorrectionForm;

    if (!summary.inspectionId) {
      setError("Inspection record is missing.");
      return;
    }

    setError(null);
    setMessage(null);
    setLoading(true);

    const csrfToken = await ensureCsrfToken();
    const correctedOdometerValue = correctionForm.odometerValue.trim()
      ? Number(correctionForm.odometerValue.trim())
      : null;

    const response = await fetch(`/api/admin/bookings/${bookingId}/inspections`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "CORRECT_ODOMETER",
        inspectionType,
        inspectionId: summary.inspectionId,
        correctedOdometerValue,
        correctionReason: correctionForm.reason,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      inspection?: LoadedBookingVehicleInspections["pickup"];
      inspections?: Pick<
        LoadedBookingVehicleInspections,
        "vehicleOdometerValue" | "vehicleOdometerUnit" | "pickup" | "returnInspection"
      >;
    };
    setLoading(false);

    if (!response.ok || !payload.ok || !payload.inspection) {
      setError(payload.error ?? "Unable to correct inspection odometer.");
      return;
    }

    applyInspectionSet({
      vehicleOdometerValue: payload.inspections?.vehicleOdometerValue ?? vehicleOdometerValue,
      vehicleOdometerUnit: payload.inspections?.vehicleOdometerUnit ?? vehicleOdometerUnit,
      pickup: payload.inspections?.pickup ?? pickupSummary,
      returnInspection: payload.inspections?.returnInspection ?? returnSummary,
    });
    setSummary(payload.inspection);
    setCorrectionForm(buildCorrectionFormState(payload.inspection));
    setOpen(false);
    setMessage(`${isPickup ? "Pickup" : "Return"} inspection odometer corrected.`);
  }

  async function uploadInspectionImages(inspectionType: "PICKUP" | "RETURN") {
    const isPickup = inspectionType === "PICKUP";
    const summary = isPickup ? pickupSummary : returnSummary;
    const uploadState = isPickup ? pickupImageUpload : returnImageUpload;
    const setUploadState = isPickup ? setPickupImageUpload : setReturnImageUpload;

    setUploadState((current) => ({
      ...current,
      loading: true,
      operation: "uploading",
      error: null,
      message: null,
    }));

    try {
      let inspectionId = summary.inspectionId;
      if (!inspectionId) {
        const draftSave = await saveInspection(inspectionType, "DRAFT");
        if (!draftSave?.inspection.inspectionId) {
          setUploadState((current) => ({
            ...current,
            loading: false,
            operation: "idle",
          }));
          return;
        }
        inspectionId = draftSave.inspection.inspectionId;
      }

      const uploadedUrls = await openUploadcareImagesDialog({
        multiple: true,
        imagesOnly: true,
      });

      if (uploadedUrls.length < 1) {
        setUploadState((current) => ({
          ...current,
          loading: false,
          operation: "idle",
          message: null,
        }));
        return;
      }

      setUploadState((current) => ({
        ...current,
        operation: "saving",
      }));
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/bookings/${bookingId}/inspections/images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          inspectionId,
          inspectionType,
          category: uploadState.category,
          files: uploadedUrls.map((url) => ({
            storageProvider: "UPLOADCARE_FILE_ID",
            storageKey: url,
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        inspections?: Pick<
          LoadedBookingVehicleInspections,
          "vehicleOdometerValue" | "vehicleOdometerUnit" | "pickup" | "returnInspection"
        >;
      };

      if (!response.ok || !payload.ok || !payload.inspections) {
        throw new Error(payload.error ?? "Unable to save inspection images.");
      }

      applyInspectionSet(payload.inspections);
      setUploadState((current) => ({
        ...current,
        loading: false,
        operation: "idle",
        message:
          uploadedUrls.length === 1
            ? `${isPickup ? "Pickup" : "Return"} image uploaded.`
            : `${uploadedUrls.length} ${isPickup ? "pickup" : "return"} images uploaded.`,
      }));
    } catch (error) {
      setUploadState((current) => ({
        ...current,
        loading: false,
        operation: "idle",
        error: getUploadcareClientErrorMessage(error),
      }));
    }
  }

  async function deleteInspectionImage(
    inspectionType: "PICKUP" | "RETURN",
    image: BookingVehicleInspectionImageSummary,
  ) {
    const isPickup = inspectionType === "PICKUP";
    const summary = isPickup ? pickupSummary : returnSummary;
    const setUploadState = isPickup ? setPickupImageUpload : setReturnImageUpload;

    if (!summary.inspectionId) {
      setUploadState((current) => ({
        ...current,
        error: "Inspection record is missing.",
      }));
      return;
    }

    const confirmed = window.confirm(
      "Remove this inspection image? It will be permanently deleted from Uploadcare when no other record uses it. This cannot be undone.",
    );
    if (!confirmed) return;

    setUploadState((current) => ({
      ...current,
      loading: true,
      operation: "deleting",
      error: null,
      message: null,
    }));

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(
        `/api/admin/bookings/${bookingId}/inspections/images/${image.id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          body: JSON.stringify({
            inspectionId: summary.inspectionId,
            inspectionType,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        inspections?: Pick<
          LoadedBookingVehicleInspections,
          "vehicleOdometerValue" | "vehicleOdometerUnit" | "pickup" | "returnInspection"
        >;
        providerFileDeleted?: boolean;
        providerFileShared?: boolean;
        cleanupWarning?: string | null;
      };

      if (!response.ok || !payload.ok || !payload.inspections) {
        throw new Error(payload.error ?? "Unable to remove inspection image.");
      }

      applyInspectionSet(payload.inspections);
      setUploadState((current) => ({
        ...current,
        loading: false,
        operation: "idle",
        message:
          payload.cleanupWarning ??
          (payload.providerFileShared
            ? "Inspection image removed. The Uploadcare file was preserved because another record uses it."
            : payload.providerFileDeleted
              ? "Inspection image removed and permanently deleted from Uploadcare."
              : "Inspection image removed."),
      }));
    } catch (error) {
      setUploadState((current) => ({
        ...current,
        loading: false,
        operation: "idle",
        error: error instanceof Error ? error.message : "Unable to remove inspection image.",
      }));
    }
  }

  return (
    <section
      data-testid="vehicle-inspection-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Vehicle Inspection</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Track odometer, fuel, damage notes, and photo evidence for booking {bookingPublicId}.
          </p>
        </div>
      </div>

      {issueFlags.warnings.length ? (
        <div
          data-testid="vehicle-inspection-warning-summary"
          className="mt-4 rounded-xl border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--ccr-status-accent-text)]">
              Inspection follow-up needed
            </span>
            {issueFlags.warnings.map((warning) => (
              <span
                key={warning.code}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getWarningBadgeClass(
                  warning.severity,
                )}`}
              >
                {warning.label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--ccr-status-accent-text)]">
            These warnings do not block completion, but they should be reviewed before closing out the booking.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--ccr-text)]">
            {issueFlags.warnings.map((warning) => (
              <li key={`${warning.code}-detail`}>{warning.description}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {tablesUnavailable ? (
        <div className="mt-4 rounded-xl border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] px-4 py-3 text-sm text-[var(--ccr-status-accent-text)]">
          Inspection tables are not installed yet. Apply the booking inspection migration to enable this section.
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section
          data-testid="pickup-inspection-card"
          className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[var(--ccr-text)]">Pickup Inspection</h3>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Complete this inspection before confirming pickup, then it becomes read-only.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getAccessBadgeClass(
                  pickupEditable ? "editable" : "locked",
                )}`}
              >
                {pickupEditable ? "Editable" : "Locked"}
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
                {formatInspectionImageCountLabel(pickupSummary.imageCount)}
              </span>
              {pickupSummary.hasOdometerCorrection ? (
                <span className="inline-flex items-center rounded-full border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-status-accent-text)]">
                  Corrected
                </span>
              ) : null}
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                  pickupSummary.displayStatus,
                )}`}
              >
                {pickupSummary.displayStatusLabel}
              </span>
            </div>
          </div>

          {!pickupEditable ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-muted)]">
              Pickup inspection is now read-only because pickup has been confirmed.
            </div>
          ) : null}

          {pickupMessage ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-sm text-[var(--ccr-status-success-text)]">
              {pickupMessage}
            </div>
          ) : null}

          {pickupError ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-sm text-[var(--ccr-status-danger-text)]">
              {pickupError}
            </div>
          ) : null}

          {pickupCorrectionMessage ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-sm text-[var(--ccr-status-success-text)]">
              {pickupCorrectionMessage}
            </div>
          ) : null}

          {pickupCorrectionError ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-sm text-[var(--ccr-status-danger-text)]">
              {pickupCorrectionError}
            </div>
          ) : null}

          <div className="mt-4 space-y-4">
            <InspectionFormFields
              form={pickupForm}
              onChange={setPickupForm}
              editable={pickupEditable}
            />

            <InspectionImagesSection
              bookingPublicId={bookingPublicId}
              summary={pickupSummary}
              editable={pickupEditable}
              uploadState={pickupImageUpload}
              onUploadStateChange={setPickupImageUpload}
              onUpload={() => void uploadInspectionImages("PICKUP")}
              onDelete={(image) => void deleteInspectionImage("PICKUP", image)}
            />

            {pickupEditable ? (
              <div className="flex flex-wrap gap-3 pb-5 pt-2">
                <button
                  type="button"
                  disabled={pickupLoading !== null}
                  onClick={() => void saveInspection("PICKUP", "DRAFT")}
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                >
                  {pickupLoading === "draft" ? "Saving..." : "Save draft"}
                </button>
                <div className="flex flex-nowrap gap-3">
                  <button
                    type="button"
                    disabled={pickupLoading !== null}
                    onClick={() => void saveInspection("PICKUP", "COMPLETED")}
                    className={buttonStyles({ variant: "primary", size: "sm" })}
                  >
                    {pickupLoading === "complete" ? "Completing..." : "Complete pickup inspection"}
                  </button>
                  <button
                    type="button"
                    data-testid="inspection-action-pickup"
                    disabled={
                      pickupLoading !== null ||
                      lifecycleLoading !== null ||
                      !canConfirmPickup
                    }
                    title={confirmPickupDisabledReason ?? undefined}
                    onClick={() => void runLifecycleAction("pickup")}
                    className={buttonStyles({ variant: "secondary", size: "sm" })}
                  >
                    {lifecycleLoading === "pickup" ? "Confirming pickup..." : "Confirm pickup"}
                  </button>
                </div>
              </div>
            ) : null}

            {!pickupEditable &&
            canCorrectOdometer &&
            pickupSummary.recordStatus === "COMPLETED" &&
            pickupSummary.inspectionId ? (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPickupCorrectionForm(buildCorrectionFormState(pickupSummary));
                    setPickupCorrectionError(null);
                    setPickupCorrectionMessage(null);
                    setPickupCorrectionOpen((current) => !current);
                  }}
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                >
                  {pickupCorrectionOpen ? "Cancel correction" : "Correct odometer"}
                </button>
              </div>
            ) : null}

            {pickupCorrectionOpen ? (
              <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                <p className="text-sm font-semibold text-[var(--ccr-text)]">Pickup odometer correction</p>
                <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                  This updates both the completed pickup inspection and the vehicle&apos;s current odometer.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Corrected odometer
                    </span>
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={pickupCorrectionForm.odometerValue}
                      onChange={(event) =>
                        setPickupCorrectionForm((current) => ({
                          ...current,
                          odometerValue: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Unit
                    </span>
                    <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]">
                      {pickupSummary.odometerUnit ?? vehicleOdometerUnit ?? "KM"}
                    </div>
                  </div>
                </div>
                <label className="mt-4 block space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Correction reason
                  </span>
                  <textarea
                    rows={3}
                    value={pickupCorrectionForm.reason}
                    onChange={(event) =>
                      setPickupCorrectionForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={pickupCorrectionLoading}
                    onClick={() => void correctInspectionOdometer("PICKUP")}
                    className={buttonStyles({ variant: "primary", size: "sm" })}
                  >
                    {pickupCorrectionLoading ? "Saving correction..." : "Save odometer correction"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <InspectionSummaryDetails summary={pickupSummary} />
        </section>

        <section
          data-testid="return-inspection-card"
          data-disabled={!returnEditable ? "true" : "false"}
          className={`rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-sm ${
            !returnEditable ? "opacity-70" : ""
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[var(--ccr-text)]">Return Inspection</h3>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Complete this inspection before completing the booking, then it becomes read-only.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getAccessBadgeClass(
                  returnEditable ? "editable" : "locked",
                )}`}
              >
                {returnEditable ? "Editable" : "Locked"}
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
                {formatInspectionImageCountLabel(returnSummary.imageCount)}
              </span>
              {returnSummary.hasOdometerCorrection ? (
                <span className="inline-flex items-center rounded-full border border-[var(--ccr-status-accent-border)] bg-[var(--ccr-status-accent-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-status-accent-text)]">
                  Corrected
                </span>
              ) : null}
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                  returnSummary.displayStatus,
                )}`}
              >
                {returnSummary.displayStatusLabel}
              </span>
            </div>
          </div>

          {!returnInspectionEnabled ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-muted)]">
              Return inspection becomes available after pickup is confirmed.
            </div>
          ) : null}

          {returnInspectionEnabled && !returnEditable ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-sm text-[var(--ccr-muted)]">
              Return inspection is now read-only because the booking has been completed.
            </div>
          ) : null}

          {returnMessage ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-sm text-[var(--ccr-status-success-text)]">
              {returnMessage}
            </div>
          ) : null}

          {returnError ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-sm text-[var(--ccr-status-danger-text)]">
              {returnError}
            </div>
          ) : null}

          {returnCorrectionMessage ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-sm text-[var(--ccr-status-success-text)]">
              {returnCorrectionMessage}
            </div>
          ) : null}

          {returnCorrectionError ? (
            <div className="mt-4 rounded-xl border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-sm text-[var(--ccr-status-danger-text)]">
              {returnCorrectionError}
            </div>
          ) : null}

          {issueFlags.warnings.length ? (
            <div className="mt-4 space-y-2">
              {issueFlags.warnings.map((warning) => (
                <div
                  key={`return-${warning.code}`}
                  data-testid={`return-warning-${warning.code.toLowerCase()}`}
                  className={`rounded-xl px-3 py-2 text-sm ${getWarningBadgeClass(warning.severity)}`}
                >
                  <span className="font-semibold">{warning.label}:</span> {warning.description}
                </div>
              ))}
            </div>
          ) : null}

          <InspectionFormFields
            form={returnForm}
            onChange={setReturnForm}
            editable={returnEditable}
          />

          <div className="mt-4">
            <InspectionImagesSection
              bookingPublicId={bookingPublicId}
              summary={returnSummary}
              editable={returnEditable}
              uploadState={returnImageUpload}
              onUploadStateChange={setReturnImageUpload}
              onUpload={() => void uploadInspectionImages("RETURN")}
              onDelete={(image) => void deleteInspectionImage("RETURN", image)}
            />
          </div>

          {returnEditable ? (
            <div className="mt-4 flex flex-wrap gap-3 pb-5 pt-2">
              <button
                type="button"
                disabled={returnLoading !== null}
                onClick={() => void saveInspection("RETURN", "DRAFT")}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                {returnLoading === "draft" ? "Saving..." : "Save draft"}
              </button>
              <div className="flex flex-nowrap gap-3">
                <button
                  type="button"
                  disabled={returnLoading !== null}
                  onClick={() => void saveInspection("RETURN", "COMPLETED")}
                  className={buttonStyles({ variant: "primary", size: "sm" })}
                >
                  {returnLoading === "complete" ? "Completing..." : "Complete return inspection"}
                </button>
                <button
                  type="button"
                  data-testid="inspection-action-complete"
                  disabled={
                    returnLoading !== null ||
                    lifecycleLoading !== null ||
                    !canCompleteBooking
                  }
                  title={completeBookingDisabledReason ?? undefined}
                  onClick={() => void runLifecycleAction("complete")}
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                >
                  {lifecycleLoading === "complete" ? "Completing booking..." : "Complete booking"}
                </button>
              </div>
            </div>
          ) : null}

          {!returnEditable &&
          canCorrectOdometer &&
          returnSummary.recordStatus === "COMPLETED" &&
          returnSummary.inspectionId ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setReturnCorrectionForm(buildCorrectionFormState(returnSummary));
                  setReturnCorrectionError(null);
                  setReturnCorrectionMessage(null);
                  setReturnCorrectionOpen((current) => !current);
                }}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                {returnCorrectionOpen ? "Cancel correction" : "Correct odometer"}
              </button>
            </div>
          ) : null}

          {returnCorrectionOpen ? (
            <div className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">Return odometer correction</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                This updates both the completed return inspection and the vehicle&apos;s current odometer.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Corrected odometer
                  </span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={returnCorrectionForm.odometerValue}
                    onChange={(event) =>
                      setReturnCorrectionForm((current) => ({
                        ...current,
                        odometerValue: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Unit
                  </span>
                  <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]">
                    {returnSummary.odometerUnit ?? vehicleOdometerUnit ?? "KM"}
                  </div>
                </div>
              </div>
              <label className="mt-4 block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Correction reason
                </span>
                <textarea
                  rows={3}
                  value={returnCorrectionForm.reason}
                  onChange={(event) =>
                    setReturnCorrectionForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={returnCorrectionLoading}
                  onClick={() => void correctInspectionOdometer("RETURN")}
                  className={buttonStyles({ variant: "primary", size: "sm" })}
                >
                  {returnCorrectionLoading ? "Saving correction..." : "Save odometer correction"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            <InspectionSummaryDetails summary={returnSummary} />
          </div>
        </section>
      </div>
      <MediaActivityPanel activities={mediaActivities} title="Inspection image activity" />
    </section>
  );
}
