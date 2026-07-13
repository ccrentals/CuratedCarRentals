"use client";

import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import {
  buildBookingLocationConfigs,
  type BookingLocationConfig,
  type BookingLocationFieldSchema,
  type BookingLocationFieldValueMap,
} from "@/lib/bookings/bookingLocations";
import {
  buildBookingLocationSelectionPayload,
  coerceBookingLocationFieldValues,
  getBookingLocationConfigByType,
  getBookingLocationConfigsForSide,
  getBookingLocationFieldSchemaForSide,
  normalizeBookingLocationFieldValuesInput,
  validateBookingLocationSelection,
} from "@/lib/bookings/locationConfigRuntime";
import type { AdminBookingDetailViewModel } from "@/lib/bookings/adminBookingDetailView";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type BookingUpdateFormProps = {
  bookingId: string;
  vehicleId: string;
  vehicleOptions: Array<{ id: string; label: string }>;
  startDate: string | Date;
  endDate: string | Date;
  pickupTime: string | null;
  dropoffTime: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickupLocationTypeKey: string;
  dropoffLocationTypeKey: string;
  pickupLocationValues: BookingLocationFieldValueMap;
  dropoffLocationValues: BookingLocationFieldValueMap;
  disabled?: boolean;
  onBookingUpdated?: (updatedBookingDetail: AdminBookingDetailViewModel) => void;
};

type BookingLocationApiField = {
  key?: unknown;
  label?: unknown;
  input_type?: unknown;
  required?: unknown;
  applies_to?: unknown;
  default_source?: unknown;
};

type BookingLocationApiRow = {
  id?: unknown;
  label?: unknown;
  location_type_key?: unknown;
  pickup_label?: unknown;
  dropoff_label?: unknown;
  allow_pickup?: unknown;
  allow_dropoff?: unknown;
  applies_to_pickup?: unknown;
  applies_to_dropoff?: unknown;
  is_active?: unknown;
  sort_order?: unknown;
  field_schema?: unknown;
  db_backed?: unknown;
};

const DEFAULT_BOOKING_LOCATIONS = buildBookingLocationConfigs();

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(value ?? 0)));
}

function toDateInputValue(value: string | Date) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function toTimeInputValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "11:00";
  const match = normalized.match(/^(\d{2}:\d{2})/);
  return match?.[1] ?? "11:00";
}

function isFieldInputType(value: unknown): value is BookingLocationFieldSchema["inputType"] {
  return value === "text" || value === "date" || value === "time";
}

function isFieldAppliesTo(value: unknown): value is BookingLocationFieldSchema["appliesTo"] {
  return value === "pickup" || value === "dropoff" || value === "both";
}

function isFieldDefaultSource(
  value: unknown,
): value is BookingLocationFieldSchema["defaultSource"] {
  return (
    value === null ||
    value === "pickup_date" ||
    value === "pickup_time" ||
    value === "dropoff_date" ||
    value === "dropoff_time"
  );
}

function normalizeFieldSchema(value: unknown) {
  if (!Array.isArray(value)) return [] as BookingLocationFieldSchema[];

  return value
    .map((entry) => {
      const field = entry as BookingLocationApiField;
      const key = typeof field.key === "string" ? field.key.trim() : "";
      const label = typeof field.label === "string" ? field.label.trim() : "";
      const inputType = field.input_type;
      const appliesTo = field.applies_to;
      const defaultSource = field.default_source ?? null;

      if (!key || !label || !isFieldInputType(inputType) || !isFieldAppliesTo(appliesTo)) {
        return null;
      }

      return {
        key,
        label,
        inputType,
        required: field.required === true,
        appliesTo,
        defaultSource: isFieldDefaultSource(defaultSource) ? defaultSource : null,
      } satisfies BookingLocationFieldSchema;
    })
    .filter((field): field is BookingLocationFieldSchema => field !== null);
}

function mapApiLocations(rows: unknown[]) {
  const configs = rows
    .map((row) => {
      const location = row as BookingLocationApiRow;
      const typeKey =
        typeof location.location_type_key === "string" ? location.location_type_key.trim() : "";
      const label = typeof location.label === "string" ? location.label.trim() : "";
      const pickupLabel =
        typeof location.pickup_label === "string" ? location.pickup_label.trim() : label;
      const dropoffLabel =
        typeof location.dropoff_label === "string" ? location.dropoff_label.trim() : label;

      if (!typeKey || !label) return null;

      return {
        id: typeof location.id === "string" ? location.id.trim() : null,
        locationType: typeKey,
        locationTypeKey: typeKey,
        label,
        pickupLabel,
        dropoffLabel,
        allowPickup: location.allow_pickup !== false,
        allowDropoff: location.allow_dropoff !== false,
        appliesToPickup: location.applies_to_pickup !== false,
        appliesToDropoff: location.applies_to_dropoff !== false,
        isActive: location.is_active !== false,
        sortOrder:
          typeof location.sort_order === "number" && Number.isFinite(location.sort_order)
            ? location.sort_order
            : 0,
        fieldSchema: normalizeFieldSchema(location.field_schema),
        dbBacked: location.db_backed === true,
      } satisfies BookingLocationConfig;
    })
    .filter((config): config is BookingLocationConfig => config !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return configs.length > 0 ? configs : DEFAULT_BOOKING_LOCATIONS;
}

function valuesDiffer(left: BookingLocationFieldValueMap, right: BookingLocationFieldValueMap) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? null) !== (right[key] ?? null)) {
      return true;
    }
  }
  return false;
}

function renderLocationFieldInput(input: {
  field: BookingLocationFieldSchema;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const { field, value, onChange } = input;
  const commonClassName =
    "mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]";

  if (field.inputType === "date") {
    return (
      <input
        type="date"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        className={commonClassName}
      />
    );
  }

  if (field.inputType === "time") {
    return (
      <input
        type="time"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        className={commonClassName}
      />
    );
  }

  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      required={field.required}
      placeholder={field.label}
      className={commonClassName}
    />
  );
}

export function BookingUpdateForm({
  bookingId,
  vehicleId,
  vehicleOptions,
  startDate,
  endDate,
  pickupTime,
  dropoffTime,
  customerName,
  customerEmail,
  customerPhone,
  pickupLocationTypeKey,
  dropoffLocationTypeKey,
  pickupLocationValues,
  dropoffLocationValues,
  disabled,
  onBookingUpdated,
}: BookingUpdateFormProps) {
  const router = useRouter();
  const startDateRef = useRef<HTMLInputElement | null>(null);
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    vehicleLabel: string;
    days: number;
    baseTotal: number;
    insuranceSelected: boolean;
    insurancePricePerDay: number;
    insuranceTotal: number;
    promoDiscount: number;
    total: number;
    depositRequired: number;
    paidToDate: number;
    balanceDue: number;
    refundRequired: boolean;
  } | null>(null);

  const [locations, setLocations] = useState<BookingLocationConfig[]>(DEFAULT_BOOKING_LOCATIONS);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  const [nextStartDate, setNextStartDate] = useState(toDateInputValue(startDate));
  const [nextVehicleId, setNextVehicleId] = useState(vehicleId);
  const [nextEndDate, setNextEndDate] = useState(toDateInputValue(endDate));
  const [nextPickupTime, setNextPickupTime] = useState(toTimeInputValue(pickupTime));
  const [nextDropoffTime, setNextDropoffTime] = useState(toTimeInputValue(dropoffTime));
  const [nextCustomerName, setNextCustomerName] = useState(customerName);
  const [nextCustomerEmail, setNextCustomerEmail] = useState(customerEmail);
  const [nextCustomerPhone, setNextCustomerPhone] = useState(customerPhone);
  const [nextPickupLocationTypeKey, setNextPickupLocationTypeKey] = useState(pickupLocationTypeKey);
  const [nextDropoffLocationTypeKey, setNextDropoffLocationTypeKey] = useState(dropoffLocationTypeKey);
  const [nextPickupLocationValues, setNextPickupLocationValues] = useState<BookingLocationFieldValueMap>(
    normalizeBookingLocationFieldValuesInput(pickupLocationValues),
  );
  const [nextDropoffLocationValues, setNextDropoffLocationValues] = useState<BookingLocationFieldValueMap>(
    normalizeBookingLocationFieldValuesInput(dropoffLocationValues),
  );
  const [dropoffLocationManuallyEdited, setDropoffLocationManuallyEdited] = useState(
    pickupLocationTypeKey !== dropoffLocationTypeKey ||
      valuesDiffer(
        normalizeBookingLocationFieldValuesInput(pickupLocationValues),
        normalizeBookingLocationFieldValuesInput(dropoffLocationValues),
      ),
  );

  const pickupLocations = useMemo(
    () => getBookingLocationConfigsForSide(locations, "pickup").filter((location) => location.isActive),
    [locations],
  );
  const dropoffLocations = useMemo(
    () => getBookingLocationConfigsForSide(locations, "dropoff").filter((location) => location.isActive),
    [locations],
  );
  const selectedPickupLocation = useMemo(
    () =>
      getBookingLocationConfigByType(pickupLocations, nextPickupLocationTypeKey, "pickup") ??
      pickupLocations[0] ??
      DEFAULT_BOOKING_LOCATIONS[0] ??
      null,
    [nextPickupLocationTypeKey, pickupLocations],
  );
  const selectedDropoffLocation = useMemo(
    () =>
      getBookingLocationConfigByType(dropoffLocations, nextDropoffLocationTypeKey, "dropoff") ??
      selectedPickupLocation,
    [dropoffLocations, nextDropoffLocationTypeKey, selectedPickupLocation],
  );
  const pickupFieldSchema = useMemo(
    () => getBookingLocationFieldSchemaForSide(selectedPickupLocation, "pickup"),
    [selectedPickupLocation],
  );
  const dropoffFieldSchema = useMemo(
    () => getBookingLocationFieldSchemaForSide(selectedDropoffLocation, "dropoff"),
    [selectedDropoffLocation],
  );
  const locationDefaultsContext = useMemo(
    () => ({
      pickupDate: nextStartDate,
      pickupTime: nextPickupTime || "11:00",
      dropoffDate: nextEndDate,
      dropoffTime: nextDropoffTime || "11:00",
    }),
    [nextDropoffTime, nextEndDate, nextPickupTime, nextStartDate],
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadLocations() {
      setLocationsLoading(true);
      setLocationsError(null);

      try {
        const response = await fetch("/api/admin/booking-locations", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          locations?: unknown[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load booking locations.");
        }

        if (cancelled) return;
        setLocations(mapApiLocations(Array.isArray(payload.locations) ? payload.locations : []));
      } catch (requestError) {
        if (cancelled) return;
        setLocations(DEFAULT_BOOKING_LOCATIONS);
        setLocationsError(
          requestError instanceof Error ? requestError.message : "Unable to load booking locations.",
        );
      } finally {
        if (!cancelled) {
          setLocationsLoading(false);
        }
      }
    }

    void loadLocations();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !nextVehicleId || !nextStartDate || !nextEndDate || !nextPickupTime || !nextDropoffTime) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    async function loadPreview() {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const response = await fetch(`/api/admin/bookings/${bookingId}/itinerary-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            vehicleId: nextVehicleId,
            startDate: nextStartDate,
            endDate: nextEndDate,
            pickupTime: nextPickupTime,
            dropoffTime: nextDropoffTime,
            customerEmail: nextCustomerEmail,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          preview?: typeof preview;
          error?: string;
        };
        if (!response.ok || !payload.preview) throw new Error(payload.error ?? "Unable to preview booking changes.");
        if (!cancelled) setPreview(payload.preview);
      } catch (requestError) {
        if (!cancelled && !controller.signal.aborted) {
          setPreview(null);
          setPreviewError(requestError instanceof Error ? requestError.message : "Unable to preview booking changes.");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }
    const timeout = window.setTimeout(() => void loadPreview(), 250);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [bookingId, nextCustomerEmail, nextDropoffTime, nextEndDate, nextPickupTime, nextStartDate, nextVehicleId, open]);

  useEffect(() => {
    setNextPickupLocationValues((current) =>
      coerceBookingLocationFieldValues(
        selectedPickupLocation,
        "pickup",
        current,
        locationDefaultsContext,
      ),
    );
  }, [locationDefaultsContext, selectedPickupLocation]);

  useEffect(() => {
    if (dropoffLocationManuallyEdited) {
      setNextDropoffLocationValues((current) =>
        coerceBookingLocationFieldValues(
          selectedDropoffLocation,
          "dropoff",
          current,
          locationDefaultsContext,
        ),
      );
      return;
    }

    const nextTypeKey =
      selectedPickupLocation &&
      dropoffLocations.some((location) => location.locationTypeKey === selectedPickupLocation.locationTypeKey)
        ? selectedPickupLocation.locationTypeKey
        : (dropoffLocations[0]?.locationTypeKey ?? selectedPickupLocation?.locationTypeKey ?? "OFFICE");

    setNextDropoffLocationTypeKey(nextTypeKey);
    setNextDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffLocations, nextTypeKey, "dropoff"),
        "dropoff",
        nextTypeKey === "CUSTOM_ADDRESS" && nextPickupLocationValues.address
          ? { address: nextPickupLocationValues.address }
          : {},
        locationDefaultsContext,
      ),
    );
  }, [
    dropoffLocationManuallyEdited,
    dropoffLocations,
    locationDefaultsContext,
    nextPickupLocationValues.address,
    selectedDropoffLocation,
    selectedPickupLocation,
  ]);

  function openPanel() {
    const normalizedPickupValues = normalizeBookingLocationFieldValuesInput(pickupLocationValues);
    const normalizedDropoffValues = normalizeBookingLocationFieldValuesInput(dropoffLocationValues);
    setNextStartDate(toDateInputValue(startDate));
    setNextVehicleId(vehicleId);
    setNextEndDate(toDateInputValue(endDate));
    setNextPickupTime(toTimeInputValue(pickupTime));
    setNextDropoffTime(toTimeInputValue(dropoffTime));
    setNextCustomerName(customerName);
    setNextCustomerEmail(customerEmail);
    setNextCustomerPhone(customerPhone);
    setNextPickupLocationTypeKey(pickupLocationTypeKey);
    setNextDropoffLocationTypeKey(dropoffLocationTypeKey);
    setNextPickupLocationValues(normalizedPickupValues);
    setNextDropoffLocationValues(normalizedDropoffValues);
    setDropoffLocationManuallyEdited(
      pickupLocationTypeKey !== dropoffLocationTypeKey ||
        valuesDiffer(normalizedPickupValues, normalizedDropoffValues),
    );
    setError(null);
    setMessage(null);
    setPreview(null);
    setPreviewError(null);
    setOpen(true);
  }

  function openNativePicker(ref: React.RefObject<HTMLInputElement | null>) {
    const input = ref.current;
    if (!input) return;
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };

    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fallback below.
      }
    }

    input.focus();
    input.click();
  }

  function handlePickupLocationChange(nextTypeKey: string) {
    setNextPickupLocationTypeKey(nextTypeKey);
    setNextPickupLocationValues((current) =>
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(pickupLocations, nextTypeKey, "pickup"),
        "pickup",
        current,
        locationDefaultsContext,
      ),
    );
  }

  function handleDropoffLocationChange(nextTypeKey: string) {
    setNextDropoffLocationTypeKey(nextTypeKey);
    setDropoffLocationManuallyEdited(true);
    setNextDropoffLocationValues((current) =>
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffLocations, nextTypeKey, "dropoff"),
        "dropoff",
        current,
        locationDefaultsContext,
      ),
    );
  }

  function handleMatchPickup() {
    const nextTypeKey =
      selectedPickupLocation &&
      dropoffLocations.some((location) => location.locationTypeKey === selectedPickupLocation.locationTypeKey)
        ? selectedPickupLocation.locationTypeKey
        : (dropoffLocations[0]?.locationTypeKey ?? "OFFICE");
    setDropoffLocationManuallyEdited(false);
    setNextDropoffLocationTypeKey(nextTypeKey);
    setNextDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffLocations, nextTypeKey, "dropoff"),
        "dropoff",
        nextPickupLocationValues.address ? { address: nextPickupLocationValues.address } : {},
        locationDefaultsContext,
      ),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || disabled) return;
    if (!preview || previewError) {
      setError(previewError ?? "Wait for a valid booking change preview before saving.");
      return;
    }

    const pickupLocationError = validateBookingLocationSelection(
      selectedPickupLocation,
      "pickup",
      nextPickupLocationValues,
    );
    if (pickupLocationError) {
      setError(pickupLocationError);
      return;
    }

    const dropoffLocationError = validateBookingLocationSelection(
      selectedDropoffLocation,
      "dropoff",
      nextDropoffLocationValues,
    );
    if (dropoffLocationError) {
      setError(dropoffLocationError);
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const confirmed = window.confirm(
        `Update this booking?\nVehicle: ${preview.vehicleLabel}\nNew total: ${formatCurrency(preview.total)}\nPaid to date: ${formatCurrency(preview.paidToDate)}\nNew balance: ${formatCurrency(preview.balanceDue)}${preview.refundRequired ? "\nRefund review will be required." : ""}`,
      );
      if (!confirmed) return;
      const csrfToken = await ensureCsrfToken();
      const locationSelection = buildBookingLocationSelectionPayload({
        configs: locations,
        pickupTypeKey: nextPickupLocationTypeKey,
        dropoffTypeKey: nextDropoffLocationTypeKey,
        pickupLocationId: selectedPickupLocation?.id ?? null,
        dropoffLocationId: selectedDropoffLocation?.id ?? null,
        pickupValues: nextPickupLocationValues,
        dropoffValues: nextDropoffLocationValues,
        context: locationDefaultsContext,
      });

      const response = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          action: "update_details",
          vehicleId: nextVehicleId,
          startDate: nextStartDate,
          endDate: nextEndDate,
          pickupTime: nextPickupTime,
          dropoffTime: nextDropoffTime,
          customerName: nextCustomerName,
          customerEmail: nextCustomerEmail,
          customerPhone: nextCustomerPhone,
          pickupLocationType: locationSelection.pickupConfig?.locationTypeKey ?? nextPickupLocationTypeKey,
          dropoffLocationType: locationSelection.dropoffConfig?.locationTypeKey ?? nextDropoffLocationTypeKey,
          pickupLocationId: locationSelection.pickupConfig?.id ?? null,
          dropoffLocationId: locationSelection.dropoffConfig?.id ?? null,
          pickupLocationTextSnapshot: locationSelection.pickupLocationTextSnapshot,
          dropoffLocationTextSnapshot: locationSelection.dropoffLocationTextSnapshot,
          bookingLocationDetails: locationSelection.details,
          csrfToken,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        bookingDetail?: AdminBookingDetailViewModel;
      };
      if (!response.ok) {
        setError(data.error ?? "Unable to update booking");
        return;
      }

      if (!data.bookingDetail) {
        setError("Booking updated, but the refreshed booking details were missing.");
        return;
      }

      setOpen(false);
      setMessage(data.message ?? "Booking updated.");
      onBookingUpdated?.(data.bookingDetail);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Unable to update booking");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Booking changes
          </p>
          <h3 className="text-sm font-semibold text-[var(--ccr-text)]">
            Update dates, customer info, and location details
          </h3>
        </div>
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPanel())}
          disabled={disabled || loading}
          className={buttonStyles({
            variant: "secondary",
            size: "sm",
            className: "rounded-lg",
          })}
        >
          {open ? "Close" : "Edit booking"}
        </button>
      </div>

      {locationsError ? <p className="mt-3 text-xs text-red-500">{locationsError}</p> : null}

      {open ? (
        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
            Vehicle
            <select
              value={nextVehicleId}
              onChange={(event) => setNextVehicleId(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {vehicleOptions.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--ccr-muted)]">
            Start date
            <div className="relative mt-1">
              <input
                ref={startDateRef}
                type="date"
                value={nextStartDate}
                onChange={(event) => setNextStartDate(event.target.value)}
                required
                className="booking-edit-date-input promo-date-time-input w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
              />
              <button
                type="button"
                onClick={() => openNativePicker(startDateRef)}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[color:var(--ccr-text)] opacity-80 transition-opacity hover:opacity-100"
                aria-label="Open start date calendar"
                title="Open calendar"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>
            </div>
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            Pickup time
            <input
              type="time"
              value={nextPickupTime}
              onChange={(event) => setNextPickupTime(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            End date
            <div className="relative mt-1">
              <input
                ref={endDateRef}
                type="date"
                value={nextEndDate}
                onChange={(event) => setNextEndDate(event.target.value)}
                min={nextStartDate}
                required
                className="booking-edit-date-input promo-date-time-input w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
              />
              <button
                type="button"
                onClick={() => openNativePicker(endDateRef)}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[color:var(--ccr-text)] opacity-80 transition-opacity hover:opacity-100"
                aria-label="Open end date calendar"
                title="Open calendar"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>
            </div>
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            Dropoff time
            <input
              type="time"
              value={nextDropoffTime}
              onChange={(event) => setNextDropoffTime(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <div className="space-y-3 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-[var(--ccr-muted)]">
                Pickup location
                <select
                  value={nextPickupLocationTypeKey}
                  onChange={(event) => handlePickupLocationChange(event.target.value)}
                  disabled={locationsLoading}
                  className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  {pickupLocations.map((location) => (
                    <option key={`pickup-${location.locationTypeKey}`} value={location.locationTypeKey}>
                      {location.pickupLabel}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs text-[var(--ccr-muted)]">Dropoff location</label>
                  <button
                    type="button"
                    onClick={handleMatchPickup}
                    className="text-xs font-semibold text-[var(--ccr-primary)] underline-offset-2 hover:underline"
                  >
                    Match pickup
                  </button>
                </div>
                <select
                  value={nextDropoffLocationTypeKey}
                  onChange={(event) => handleDropoffLocationChange(event.target.value)}
                  disabled={locationsLoading}
                  className="w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  {dropoffLocations.map((location) => (
                    <option key={`dropoff-${location.locationTypeKey}`} value={location.locationTypeKey}>
                      {location.dropoffLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {pickupFieldSchema.length > 0 || dropoffFieldSchema.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  {pickupFieldSchema.map((field) => (
                    <label key={`pickup-${field.key}`} className="block text-xs text-[var(--ccr-muted)]">
                      {field.label}
                      {renderLocationFieldInput({
                        field,
                        value: nextPickupLocationValues[field.key] ?? null,
                        onChange: (value) =>
                          setNextPickupLocationValues((current) => ({
                            ...current,
                            [field.key]: value,
                          })),
                      })}
                    </label>
                  ))}
                </div>

                <div className="space-y-3">
                  {dropoffFieldSchema.map((field) => (
                    <label key={`dropoff-${field.key}`} className="block text-xs text-[var(--ccr-muted)]">
                      {field.label}
                      {renderLocationFieldInput({
                        field,
                        value: nextDropoffLocationValues[field.key] ?? null,
                        onChange: (value) => {
                          setDropoffLocationManuallyEdited(true);
                          setNextDropoffLocationValues((current) => ({
                            ...current,
                            [field.key]: value,
                          }));
                        },
                      })}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <label className="text-xs text-[var(--ccr-muted)]">
            Customer name
            <input
              type="text"
              value={nextCustomerName}
              onChange={(event) => setNextCustomerName(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            Customer email
            <input
              type="email"
              value={nextCustomerEmail}
              onChange={(event) => setNextCustomerEmail(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
            Customer phone
            <input
              type="tel"
              value={nextCustomerPhone}
              onChange={(event) => setNextCustomerPhone(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <section className="md:col-span-2 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
            <p className="text-xs font-semibold uppercase text-[var(--ccr-muted)]">Change preview</p>
            {previewLoading ? <p className="mt-2 text-sm text-[var(--ccr-muted)]">Checking availability and pricing...</p> : null}
            {previewError ? <p className="mt-2 text-sm text-red-500">{previewError}</p> : null}
            {preview && !previewLoading ? (
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-[var(--ccr-muted)]">Vehicle</dt><dd className="font-semibold">{preview.vehicleLabel}</dd></div>
                <div><dt className="text-[var(--ccr-muted)]">Days</dt><dd className="font-semibold">{preview.days}</dd></div>
                <div><dt className="text-[var(--ccr-muted)]">New total</dt><dd className="font-semibold">{formatCurrency(preview.total)}</dd></div>
                <div><dt className="text-[var(--ccr-muted)]">New balance</dt><dd className="font-semibold">{formatCurrency(preview.balanceDue)}</dd></div>
                <div><dt className="text-[var(--ccr-muted)]">Base rental</dt><dd>{formatCurrency(preview.baseTotal)}</dd></div>
                <div>
                  <dt className="text-[var(--ccr-muted)]">Insurance</dt>
                  <dd>{preview.insuranceSelected ? `${formatCurrency(preview.insurancePricePerDay)} / day` : "Not selected"}</dd>
                </div>
                <div><dt className="text-[var(--ccr-muted)]">Insurance total</dt><dd>{formatCurrency(preview.insuranceTotal)}</dd></div>
                <div><dt className="text-[var(--ccr-muted)]">Discount</dt><dd>-{formatCurrency(preview.promoDiscount)}</dd></div>
                <div><dt className="text-[var(--ccr-muted)]">Paid to date</dt><dd>{formatCurrency(preview.paidToDate)}</dd></div>
                {preview.insuranceSelected ? (
                  <p className="sm:col-span-2 lg:col-span-4 text-xs text-[var(--ccr-muted)]">
                    Insurance remains selected and is recalculated using the selected vehicle&apos;s active rate.
                  </p>
                ) : null}
                {preview.refundRequired ? <p className="sm:col-span-2 lg:col-span-4 font-semibold text-red-500">Refund review required after this change.</p> : null}
              </dl>
            ) : null}
          </section>

          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={loading || disabled}
              className={buttonStyles({
                variant: "primary",
                size: "sm",
                className: "rounded-lg",
              })}
            >
              {loading ? "Saving..." : "Save changes"}
            </button>
            {message ? <span className="text-xs text-emerald-600">{message}</span> : null}
            {error ? <span className="text-xs text-red-500">{error}</span> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
