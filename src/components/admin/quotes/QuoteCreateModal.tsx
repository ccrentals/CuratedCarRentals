"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { useDialogA11y } from "@/components/admin/useDialogA11y";
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
import {
  formatTagsInput,
  parseTagsInput,
  toDateInputValue,
  toDateTimeLocalValue,
  toIsoFromDateInput,
  toIsoFromDateTimeLocal,
} from "@/lib/quotes/quoteUi";
import { formatJmd } from "@/lib/money";

type AvailableVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  category?: string;
};

type InsurancePlanOption = {
  id: string;
  vehicle_id: string | null;
  is_enabled: boolean;
  price_per_day_cents: number;
  is_global_default: boolean;
};

type PricingPreview = {
  days: number;
  baseTotal: number;
  insuranceTotal: number;
  discountTotal: number;
  subtotal: number;
  total: number;
  depositRequired: number;
  amountDue: number;
};

type PromoOption = {
  id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  discount_value: number;
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  start_at: string | null;
  end_at: string | null;
  remaining_redemptions: number | null;
};

type QuoteCreateModalProps = {
  onCreated: (id: string) => void;
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

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function nowRoundedToMinutes() {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
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
  const nextLocations = rows
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
    .filter((location): location is BookingLocationConfig => location !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return nextLocations.length > 0 ? nextLocations : DEFAULT_BOOKING_LOCATIONS;
}

function isVehicleOption(value: unknown): value is AvailableVehicle {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.make === "string" &&
    typeof row.model === "string" &&
    typeof row.year === "number"
  );
}

function isInsurancePlanOption(value: unknown): value is InsurancePlanOption {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.is_enabled === "boolean" &&
    typeof row.price_per_day_cents === "number"
  );
}

function isPromoOption(value: unknown): value is PromoOption {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.code === "string" && typeof row.is_active === "boolean";
}

function isPromoCurrentlyActive(promo: PromoOption, now = Date.now()) {
  if (!promo.is_active) return false;
  const startsAt = promo.start_at ? new Date(promo.start_at).getTime() : null;
  if (startsAt !== null && Number.isFinite(startsAt) && now < startsAt) return false;
  const endsAt = promo.end_at ? new Date(promo.end_at).getTime() : null;
  if (endsAt !== null && Number.isFinite(endsAt) && now > endsAt) return false;
  if (promo.remaining_redemptions !== null && promo.remaining_redemptions <= 0) return false;
  return true;
}

function formatPromoOptionLabel(promo: PromoOption) {
  const discount =
    promo.discount_type === "PERCENT"
      ? `${Math.round(Number(promo.discount_value || 0))}%`
      : formatJmd(Math.round(Number(promo.discount_value || 0)));
  const scope = promo.apply_scope === "DAYS_TOTAL" ? "Days total" : "Overall total";
  const remaining =
    promo.remaining_redemptions === null ? "" : `, ${Math.max(0, promo.remaining_redemptions)} left`;
  return `${promo.code} (${discount}, ${scope}${remaining})`;
}

function renderLocationFieldInput(input: {
  field: BookingLocationFieldSchema;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const { field, value, onChange } = input;
  const commonClassName =
    "mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]";

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

const DEFAULT_BOOKING_LOCATIONS = buildBookingLocationConfigs();

export function QuoteCreateModal({ onCreated }: QuoteCreateModalProps) {
  const [open, setOpen] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [locations, setLocations] = useState<BookingLocationConfig[]>(DEFAULT_BOOKING_LOCATIONS);
  const [vehicles, setVehicles] = useState<AvailableVehicle[]>([]);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlanOption[]>([]);
  const [promoOptions, setPromoOptions] = useState<PromoOption[]>([]);

  const [customerFullName, setCustomerFullName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [startAtLocal, setStartAtLocal] = useState(() => toDateTimeLocalValue(nowRoundedToMinutes()));
  const [endAtLocal, setEndAtLocal] = useState(() => toDateTimeLocalValue(addDays(nowRoundedToMinutes(), 2)));

  const [pickupLocationTypeKey, setPickupLocationTypeKey] = useState("OFFICE");
  const [dropoffLocationTypeKey, setDropoffLocationTypeKey] = useState("OFFICE");
  const [pickupLocationValues, setPickupLocationValues] = useState<BookingLocationFieldValueMap>({});
  const [dropoffLocationValues, setDropoffLocationValues] = useState<BookingLocationFieldValueMap>({});
  const [dropoffLocationManuallyEdited, setDropoffLocationManuallyEdited] = useState(false);

  const [vehicleId, setVehicleId] = useState("");
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [insurancePlanId, setInsurancePlanId] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [expiresDate, setExpiresDate] = useState(() => toDateInputValue(addDays(new Date(), 7).toISOString()));

  const [tagsInput, setTagsInput] = useState("");
  const [comments, setComments] = useState("");
  const [commissionPartnerName, setCommissionPartnerName] = useState("");
  const [clientPaysAtPartner, setClientPaysAtPartner] = useState(false);
  const [rackPriceInput, setRackPriceInput] = useState("");

  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const handleClose = useCallback(() => setOpen(false), []);

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
      getBookingLocationConfigByType(pickupLocations, pickupLocationTypeKey, "pickup") ??
      pickupLocations[0] ??
      DEFAULT_BOOKING_LOCATIONS[0] ??
      null,
    [pickupLocationTypeKey, pickupLocations],
  );
  const selectedDropoffLocation = useMemo(
    () =>
      getBookingLocationConfigByType(dropoffLocations, dropoffLocationTypeKey, "dropoff") ??
      selectedPickupLocation,
    [dropoffLocationTypeKey, dropoffLocations, selectedPickupLocation],
  );
  const pickupFieldSchema = useMemo(
    () => getBookingLocationFieldSchemaForSide(selectedPickupLocation, "pickup"),
    [selectedPickupLocation],
  );
  const dropoffFieldSchema = useMemo(
    () => getBookingLocationFieldSchemaForSide(selectedDropoffLocation, "dropoff"),
    [selectedDropoffLocation],
  );
  const locationDefaultsContext = useMemo(() => {
    const startAtIso = toIsoFromDateTimeLocal(startAtLocal);
    const endAtIso = toIsoFromDateTimeLocal(endAtLocal);
    return {
      pickupDate: startAtIso ? startAtIso.slice(0, 10) : "",
      pickupTime: startAtLocal.split("T")[1] ?? "11:00",
      dropoffDate: endAtIso ? endAtIso.slice(0, 10) : "",
      dropoffTime: endAtLocal.split("T")[1] ?? "11:00",
    };
  }, [endAtLocal, startAtLocal]);

  const availableInsurancePlans = useMemo(() => {
    if (!insuranceEnabled) return [] as InsurancePlanOption[];
    return insurancePlans.filter(
      (plan) => plan.is_enabled && (!plan.vehicle_id || !vehicleId || plan.vehicle_id === vehicleId),
    );
  }, [insuranceEnabled, insurancePlans, vehicleId]);

  useDialogA11y({
    open,
    onClose: handleClose,
    dialogRef,
    restoreFocusRef: triggerRef,
  });

  const loadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    setError(null);

    try {
      const [locationsResponse, insuranceResponse, promoResponse] = await Promise.all([
        fetch("/api/admin/booking-locations", { cache: "no-store" }),
        fetch("/api/admin/insurance-plans", { cache: "no-store" }),
        fetch("/api/admin/promo-codes", { cache: "no-store" }),
      ]);

      const locationsData = (await locationsResponse.json().catch(() => ({}))) as {
        locations?: unknown[];
        error?: string;
      };
      const insuranceData = (await insuranceResponse.json().catch(() => ({}))) as {
        plans?: unknown[];
        error?: string;
      };
      const promoData = (await promoResponse.json().catch(() => ({}))) as {
        promos?: unknown[];
      };

      if (!locationsResponse.ok) {
        throw new Error(locationsData.error ?? "Unable to load booking locations.");
      }
      if (!insuranceResponse.ok) {
        throw new Error(insuranceData.error ?? "Unable to load insurance plans.");
      }

      const nextLocations = mapApiLocations(
        Array.isArray(locationsData.locations) ? locationsData.locations : [],
      );
      const nextPlans = Array.isArray(insuranceData.plans)
        ? insuranceData.plans.filter(isInsurancePlanOption)
        : [];
      const nextPromos = Array.isArray(promoData.promos)
        ? promoData.promos.filter(isPromoOption).filter((promo) => isPromoCurrentlyActive(promo))
        : [];

      setLocations(nextLocations);
      setPickupLocationTypeKey((current) =>
        nextLocations.some((location) => location.locationTypeKey === current)
          ? current
          : (getBookingLocationConfigsForSide(nextLocations, "pickup")[0]?.locationTypeKey ?? "OFFICE"),
      );
      setDropoffLocationTypeKey((current) =>
        nextLocations.some((location) => location.locationTypeKey === current)
          ? current
          : (getBookingLocationConfigsForSide(nextLocations, "dropoff")[0]?.locationTypeKey ?? "OFFICE"),
      );
      setInsurancePlans(nextPlans);
      setPromoOptions(nextPromos);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load quote options.");
      setLocations(DEFAULT_BOOKING_LOCATIONS);
      setInsurancePlans([]);
      setPromoOptions([]);
    } finally {
      setLoadingBootstrap(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadBootstrap();
  }, [loadBootstrap, open]);

  useEffect(() => {
    if (!open) return;

    const startIso = toIsoFromDateTimeLocal(startAtLocal);
    const endIso = toIsoFromDateTimeLocal(endAtLocal);
    if (!startIso || !endIso) {
      setVehicles([]);
      return;
    }

    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setVehicles([]);
      return;
    }

    const pickupDate = start.toISOString().slice(0, 10);
    const dropoffDate = end.toISOString().slice(0, 10);
    const pickupTime = startAtLocal.split("T")[1] ?? "00:00";
    const dropoffTime = endAtLocal.split("T")[1] ?? "23:59";

    let isCancelled = false;

    const loadVehicles = async () => {
      const params = new URLSearchParams({ pickupDate, dropoffDate, pickupTime, dropoffTime });
      const response = await fetch(`/api/public/vehicles?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { vehicles?: unknown[] };
      if (isCancelled) return;

      if (!response.ok) {
        setVehicles([]);
        return;
      }

      const nextVehicles = Array.isArray(payload.vehicles)
        ? payload.vehicles.filter(isVehicleOption)
        : [];
      setVehicles(nextVehicles);
      if (vehicleId && !nextVehicles.some((vehicle) => vehicle.id === vehicleId)) {
        setVehicleId("");
      }
    };

    void loadVehicles();

    return () => {
      isCancelled = true;
    };
  }, [endAtLocal, open, startAtLocal, vehicleId]);

  useEffect(() => {
    if (!open) return;
    if (!insuranceEnabled) {
      setInsurancePlanId("");
      return;
    }

    if (insurancePlanId && availableInsurancePlans.some((plan) => plan.id === insurancePlanId)) {
      return;
    }

    const preferred =
      availableInsurancePlans.find((plan) => plan.vehicle_id === vehicleId) ??
      availableInsurancePlans.find((plan) => plan.is_global_default) ??
      availableInsurancePlans[0];

    setInsurancePlanId(preferred?.id ?? "");
  }, [availableInsurancePlans, insuranceEnabled, insurancePlanId, open, vehicleId]);

  useEffect(() => {
    if (!open) return;
    setPickupLocationValues((current) =>
      coerceBookingLocationFieldValues(
        selectedPickupLocation,
        "pickup",
        normalizeBookingLocationFieldValuesInput(current),
        locationDefaultsContext,
      ),
    );
  }, [locationDefaultsContext, open, selectedPickupLocation]);

  useEffect(() => {
    if (!open) return;
    if (dropoffLocationManuallyEdited) {
      setDropoffLocationValues((current) =>
        coerceBookingLocationFieldValues(
          selectedDropoffLocation,
          "dropoff",
          normalizeBookingLocationFieldValuesInput(current),
          locationDefaultsContext,
        ),
      );
      return;
    }

    setDropoffLocationTypeKey(selectedPickupLocation?.locationTypeKey ?? "OFFICE");
    setDropoffLocationValues(
      coerceBookingLocationFieldValues(
        selectedPickupLocation,
        "dropoff",
        normalizeBookingLocationFieldValuesInput(pickupLocationValues),
        locationDefaultsContext,
      ),
    );
  }, [
    dropoffLocationManuallyEdited,
    locationDefaultsContext,
    open,
    pickupLocationValues,
    selectedDropoffLocation,
    selectedPickupLocation,
  ]);

  useEffect(() => {
    if (!open) return;
    if (!vehicleId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    const startAt = toIsoFromDateTimeLocal(startAtLocal);
    const endAt = toIsoFromDateTimeLocal(endAtLocal);
    if (!startAt || !endAt) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let isCancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/public/pricing/quote", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            vehicleId,
            startAt,
            endAt,
            insuranceSelected: insuranceEnabled,
            insurancePlanId: insuranceEnabled ? insurancePlanId || null : null,
            promoCode: promoCode.trim() || null,
            customerEmail: customerEmail.trim() || null,
            paymentOption: "DEPOSIT",
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          summary?: PricingPreview;
        };

        if (isCancelled) return;

        if (!response.ok || !payload.ok || !payload.summary) {
          setPreview(null);
          setPreviewError(payload.error ?? "Unable to preview quote pricing.");
          return;
        }

        setPreview(payload.summary);
      } catch {
        if (isCancelled) return;
        setPreview(null);
        setPreviewError("Unable to preview quote pricing.");
      } finally {
        if (!isCancelled) {
          setPreviewLoading(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerEmail, endAtLocal, insuranceEnabled, insurancePlanId, open, promoCode, startAtLocal, vehicleId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const startAtIso = toIsoFromDateTimeLocal(startAtLocal);
    const endAtIso = toIsoFromDateTimeLocal(endAtLocal);
    if (!startAtIso || !endAtIso) {
      setError("Pickup and return dates are required.");
      setSubmitting(false);
      return;
    }

    const expiresAtIso = toIsoFromDateInput(expiresDate, "end");
    const csrfToken = await ensureCsrfToken();

    try {
      const locationSelection = buildBookingLocationSelectionPayload({
        configs: locations,
        pickupTypeKey: selectedPickupLocation?.locationTypeKey ?? pickupLocationTypeKey,
        dropoffTypeKey: selectedDropoffLocation?.locationTypeKey ?? dropoffLocationTypeKey,
        pickupLocationId: selectedPickupLocation?.id ?? null,
        dropoffLocationId: selectedDropoffLocation?.id ?? null,
        pickupValues: pickupLocationValues,
        dropoffValues: dropoffLocationValues,
        context: locationDefaultsContext,
      });

      const pickupError = validateBookingLocationSelection(
        locationSelection.pickupConfig,
        "pickup",
        locationSelection.pickupValues,
      );
      if (pickupError) {
        setError(pickupError);
        setSubmitting(false);
        return;
      }

      const dropoffError = validateBookingLocationSelection(
        locationSelection.dropoffConfig,
        "dropoff",
        locationSelection.dropoffValues,
      );
      if (dropoffError) {
        setError(dropoffError);
        setSubmitting(false);
        return;
      }

      const response = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          csrfToken,
          customer_full_name: customerFullName,
          customer_email: customerEmail,
          customer_phone: customerPhone || null,
          start_at: startAtIso,
          end_at: endAtIso,
          pickup_location_id: selectedPickupLocation?.id ?? null,
          dropoff_location_id: selectedDropoffLocation?.id ?? null,
          pickup_location_type: locationSelection.pickupConfig?.locationTypeKey ?? pickupLocationTypeKey,
          dropoff_location_type: locationSelection.dropoffConfig?.locationTypeKey ?? dropoffLocationTypeKey,
          pickup_location_text: locationSelection.pickupLocationTextSnapshot,
          dropoff_location_text: locationSelection.dropoffLocationTextSnapshot,
          pickup_location_text_snapshot: locationSelection.pickupLocationTextSnapshot,
          dropoff_location_text_snapshot: locationSelection.dropoffLocationTextSnapshot,
          booking_location_details: locationSelection.details,
          vehicle_id: vehicleId,
          insurance_enabled: insuranceEnabled,
          insurance_plan_id: insuranceEnabled ? insurancePlanId || null : null,
          promo_code: promoCode.trim() || null,
          expires_at: expiresAtIso,
          tags: parseTagsInput(tagsInput),
          comments: comments.trim() || null,
          commission_partner_name: commissionPartnerName.trim() || null,
          client_pays_at_partner: clientPaysAtPartner,
          rack_price_cents: rackPriceInput.trim() ? Number(rackPriceInput) : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item?: { id?: string };
      };

      if (!response.ok || !payload.ok || !payload.item?.id) {
        setError(payload.error ?? "Unable to create quote.");
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      setOpen(false);
      onCreated(payload.item.id);
    } catch {
      setError("Unable to create quote.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
        }}
        data-testid="quote-create"
        className={buttonStyles({
          variant: "secondary",
          size: "sm",
          className:
            "border-[var(--ccr-accent)] ring-1 ring-[var(--ccr-accent)] hover:border-[var(--ccr-accent-strong)]",
        })}
      >
        Create quote
      </button>

      <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={handleClose}
        />
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Create quote"
          tabIndex={open ? -1 : undefined}
          className={`absolute right-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-2xl overflow-hidden border-l border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col">
            <header className="flex items-start justify-between gap-3 border-b border-[var(--ccr-border)] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Quotes</p>
                <h2 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">Create Quote</h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
              >
                Close
              </button>
            </header>

            <form id="quote-create-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4">
                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Customer full name
                    <input
                      required
                      value={customerFullName}
                      onChange={(event) => setCustomerFullName(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Customer email
                    <input
                      required
                      type="email"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Customer phone
                    <input
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Pickup date/time
                    <input
                      required
                      type="datetime-local"
                      value={startAtLocal}
                      onChange={(event) => setStartAtLocal(event.target.value)}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Return date/time
                    <input
                      required
                      type="datetime-local"
                      value={endAtLocal}
                      onChange={(event) => setEndAtLocal(event.target.value)}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Pickup location
                    <select
                      required
                      value={selectedPickupLocation?.locationTypeKey ?? ""}
                      onChange={(event) => {
                        setPickupLocationTypeKey(event.target.value);
                        setDropoffLocationManuallyEdited(false);
                      }}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">Select pickup location</option>
                      {pickupLocations.map((location) => (
                        <option key={location.locationTypeKey} value={location.locationTypeKey}>
                          {location.pickupLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Dropoff location
                    <select
                      required
                      value={selectedDropoffLocation?.locationTypeKey ?? ""}
                      onChange={(event) => {
                        setDropoffLocationTypeKey(event.target.value);
                        setDropoffLocationManuallyEdited(true);
                      }}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">Select dropoff location</option>
                      {dropoffLocations.map((location) => (
                        <option key={location.locationTypeKey} value={location.locationTypeKey}>
                          {location.dropoffLabel}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setDropoffLocationManuallyEdited(false);
                        setDropoffLocationTypeKey(selectedPickupLocation?.locationTypeKey ?? "OFFICE");
                        setDropoffLocationValues(
                          coerceBookingLocationFieldValues(
                            selectedPickupLocation,
                            "dropoff",
                            normalizeBookingLocationFieldValuesInput(pickupLocationValues),
                            locationDefaultsContext,
                          ),
                        );
                      }}
                      className={buttonStyles({
                        variant: "secondary",
                        size: "sm",
                        className: "rounded-lg",
                      })}
                    >
                      Match pickup
                    </button>
                  </div>

                  {pickupFieldSchema.map((field) => (
                    <label key={`pickup-${field.key}`} className="text-xs text-[var(--ccr-muted)]">
                      {field.label}
                      {renderLocationFieldInput({
                        field,
                        value: pickupLocationValues[field.key] ?? "",
                        onChange: (value) => {
                          setPickupLocationValues((current) => ({
                            ...current,
                            [field.key]: value,
                          }));
                        },
                      })}
                    </label>
                  ))}

                  {dropoffFieldSchema.map((field) => (
                    <label key={`dropoff-${field.key}`} className="text-xs text-[var(--ccr-muted)]">
                      {field.label}
                      {renderLocationFieldInput({
                        field,
                        value: dropoffLocationValues[field.key] ?? "",
                        onChange: (value) => {
                          setDropoffLocationManuallyEdited(true);
                          setDropoffLocationValues((current) => ({
                            ...current,
                            [field.key]: value,
                          }));
                        },
                      })}
                    </label>
                  ))}

                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Vehicle (available for selected window)
                    <select
                      required
                      value={vehicleId}
                      onChange={(event) => setVehicleId(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">Select vehicle</option>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={insuranceEnabled}
                      onChange={(event) => setInsuranceEnabled(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Insurance enabled
                  </label>

                  {insuranceEnabled ? (
                    <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                      Insurance plan
                      <select
                        value={insurancePlanId}
                        onChange={(event) => setInsurancePlanId(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      >
                        <option value="">Auto-select plan</option>
                        {availableInsurancePlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.vehicle_id ? "Vehicle plan" : "Global plan"} · {formatJmd(plan.price_per_day_cents)} / day
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Promo code
                    <select
                      value={promoCode}
                      onChange={(event) => setPromoCode(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    >
                      <option value="">No promo</option>
                      {promoOptions.map((promo) => (
                        <option key={promo.id} value={promo.code}>
                          {formatPromoOptionLabel(promo)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Expires on
                    <input
                      type="date"
                      value={expiresDate}
                      onChange={(event) => setExpiresDate(event.target.value)}
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Tags (comma-separated)
                    <input
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                      placeholder="vip, airport"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Comments
                    <textarea
                      value={comments}
                      onChange={(event) => setComments(event.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Commission partner
                    <input
                      value={commissionPartnerName}
                      onChange={(event) => setCommissionPartnerName(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Rack price (JMD)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={rackPriceInput}
                      onChange={(event) => setRackPriceInput(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={clientPaysAtPartner}
                      onChange={(event) => setClientPaysAtPartner(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Client pays at partner
                  </label>
                </section>

                <section className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Pricing Preview</p>
                  {previewLoading ? <p className="mt-2 text-xs text-[var(--ccr-muted)]">Calculating...</p> : null}
                  {previewError ? <p className="mt-2 text-xs text-amber-200">{previewError}</p> : null}
                  {preview ? (
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--ccr-muted)] sm:grid-cols-4">
                      <div>
                        <dt>Base</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.baseTotal)}</dd>
                      </div>
                      <div>
                        <dt>Insurance</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.insuranceTotal)}</dd>
                      </div>
                      <div>
                        <dt>Discount</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">-{formatJmd(preview.discountTotal)}</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.total)}</dd>
                      </div>
                      <div>
                        <dt>Subtotal</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.subtotal)}</dd>
                      </div>
                      <div>
                        <dt>Deposit</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.depositRequired)}</dd>
                      </div>
                      <div>
                        <dt>Amount due</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(preview.amountDue)}</dd>
                      </div>
                      <div>
                        <dt>Days</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{preview.days}</dd>
                      </div>
                    </dl>
                  ) : null}
                </section>

                {error ? <p className="text-xs font-semibold text-red-300">{error}</p> : null}
                {loadingBootstrap ? <p className="text-xs text-[var(--ccr-muted)]">Loading options...</p> : null}
              </div>
            </form>

            <footer className="sticky bottom-0 flex items-center justify-between border-t border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-5 py-4">
              <p className="text-xs text-[var(--ccr-muted)]">{formatTagsInput(parseTagsInput(tagsInput)) || "No tags"}</p>
              <button
                type="submit"
                form="quote-create-form"
                disabled={submitting}
                data-testid="quote-save"
                className={buttonStyles({
                  variant: "primary",
                  size: "sm",
                  className: "rounded-lg",
                })}
              >
                {submitting ? "Saving..." : "Save quote"}
              </button>
            </footer>
          </div>
        </section>
      </div>
    </>
  );
}
