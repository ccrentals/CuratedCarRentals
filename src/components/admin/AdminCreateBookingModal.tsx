"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import {
  buildBookingLocationConfigs,
  type BookingLocationConfig,
  type BookingLocationFieldSchema,
  type BookingLocationFieldValueMap,
} from "@/lib/bookings/bookingLocations";
import {
  isAdminCreateBookingDateRangeValid,
  suggestAdminCreateBookingEndDate,
  suggestAdminCreateBookingPaymentAmount,
} from "@/lib/bookings/adminCreateBookingDates";
import {
  buildBookingLocationSelectionPayload,
  coerceBookingLocationFieldValues,
  getBookingLocationConfigByType,
  getBookingLocationConfigsForSide,
  getBookingLocationFieldSchemaForSide,
  validateBookingLocationSelection,
} from "@/lib/bookings/locationConfigRuntime";
import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleOption = {
  id: string;
  label: string;
  year: number;
  make: string;
  model: string;
  dailyRateCents: number;
  depositCents: number;
};

type PricingPreview = {
  days: number;
  dailyRateCents: number;
  baseTotalCents: number;
  insuranceSelected: boolean;
  insurancePlanId: string | null;
  insurancePricePerDayCents: number;
  insuranceTotalCents: number;
  subtotalCents: number;
  promoCode: string | null;
  promoDiscountCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  dueNowCents: number;
  balanceDueCents: number;
  rateBreakdown: Array<{
    date: string;
    dailyRateCents: number;
    source: "base" | "weekend" | "date_override";
  }>;
  currency: "JMD";
};

type InsuranceOption = {
  enabled: boolean;
  planId: string | null;
  pricePerDayCents: number;
  coverageCents: number;
};

type AdminCreateBookingModalProps = {
  initialOpen?: boolean;
  clearOpenHref?: string;
  initialCustomer?: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
  } | null;
};

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "POS_CARD", label: "POS/Card on delivery" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
] as const;

type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]["value"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toDateTimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

const DEFAULT_BOOKING_LOCATIONS = buildBookingLocationConfigs();

export function AdminCreateBookingModal({
  initialOpen = false,
  clearOpenHref,
  initialCustomer = null,
}: AdminCreateBookingModalProps) {
  const router = useRouter();
  const initialStartDate = todayIso();
  const initialEndDate = suggestAdminCreateBookingEndDate(initialStartDate) ?? initialStartDate;
  const [open, setOpen] = useState(initialOpen);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [endDateManuallyEdited, setEndDateManuallyEdited] = useState(false);
  const [pickupLocationTypeKey, setPickupLocationTypeKey] = useState("OFFICE");
  const [dropoffLocationTypeKey, setDropoffLocationTypeKey] = useState("OFFICE");
  const [pickupLocationValues, setPickupLocationValues] = useState<BookingLocationFieldValueMap>({});
  const [dropoffLocationValues, setDropoffLocationValues] = useState<BookingLocationFieldValueMap>({});
  const [dropoffLocationManuallyEdited, setDropoffLocationManuallyEdited] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [protectionChoice, setProtectionChoice] = useState<"" | "NONE" | "STANDARD">("");
  const [insuranceOption, setInsuranceOption] = useState<InsuranceOption>({
    enabled: false,
    planId: null,
    pricePerDayCents: 0,
    coverageCents: 0,
  });
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [insuranceError, setInsuranceError] = useState<string | null>(null);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [fullName, setFullName] = useState(initialCustomer?.fullName ?? "");
  const [email, setEmail] = useState(initialCustomer?.email ?? "");
  const [phone, setPhone] = useState(initialCustomer?.phone ?? "");
  const [selectedCustomerId] = useState(initialCustomer?.id ?? "");
  const [recordPaymentNow, setRecordPaymentNow] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAmountManuallyEdited, setPaymentAmountManuallyEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>("CASH");
  const [paymentDateTime, setPaymentDateTime] = useState(() => toDateTimeLocalValue(new Date()));
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [locations, setLocations] = useState<BookingLocationConfig[]>(DEFAULT_BOOKING_LOCATIONS);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [availableVehicles, setAvailableVehicles] = useState<VehicleOption[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentWarning, setPaymentWarning] = useState<string | null>(null);
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);

  const datesValid = useMemo(
    () => isAdminCreateBookingDateRangeValid(startDate, endDate),
    [endDate, startDate],
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
      getBookingLocationConfigByType(pickupLocations, pickupLocationTypeKey, "pickup") ??
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
  const locationDefaultsContext = useMemo(
    () => ({
      pickupDate: startDate,
      pickupTime: "11:00",
      dropoffDate: endDate,
      dropoffTime: "11:00",
    }),
    [endDate, startDate],
  );
  const suggestedPaymentAmount = useMemo(
    () => suggestAdminCreateBookingPaymentAmount(preview?.depositRequiredCents),
    [preview?.depositRequiredCents],
  );

  const closeModal = useCallback(() => {
    if (loading) return;
    setOpen(false);
    setError(null);
    setPaymentWarning(null);
    if (clearOpenHref) {
      router.replace(clearOpenHref, { scroll: false });
    }
  }, [clearOpenHref, loading, router]);

  const formattedPreviewStartDate = useMemo(() => {
    if (!startDate) return "Not selected";
    const date = new Date(`${startDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return startDate;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  }, [startDate]);

  const formattedPreviewEndDate = useMemo(() => {
    if (!endDate) return "Not selected";
    const date = new Date(`${endDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return endDate;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  }, [endDate]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeModal, open]);

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
          throw new Error(payload.error ?? "Unable to load pickup locations.");
        }

        if (cancelled) return;
        const nextLocations = Array.isArray(payload.locations)
          ? payload.locations
              .map((value) => {
                if (!value || typeof value !== "object") return null;
                const location = value as {
                  id?: unknown;
                  label?: unknown;
                  location_type_key?: unknown;
                  pickup_label?: unknown;
                  dropoff_label?: unknown;
                  location_type?: unknown;
                  allow_pickup?: unknown;
                  allow_dropoff?: unknown;
                  applies_to_pickup?: unknown;
                  applies_to_dropoff?: unknown;
                  field_schema?: unknown;
                  is_active?: unknown;
                  db_backed?: unknown;
                  sort_order?: unknown;
                };
                const locationTypeKey =
                  (typeof location.location_type_key === "string" && location.location_type_key.trim()) ||
                  (typeof location.location_type === "string" && location.location_type.trim()) ||
                  "";
                if (!locationTypeKey) return null;
                const fallback =
                  DEFAULT_BOOKING_LOCATIONS.find(
                    (item) => item.locationTypeKey === locationTypeKey,
                  ) ?? null;
                return {
                  id: typeof location.id === "string" && location.id.trim() ? location.id.trim() : null,
                  locationType: locationTypeKey,
                  locationTypeKey,
                  label:
                    typeof location.label === "string" && location.label.trim()
                      ? location.label.trim()
                      : fallback?.label ?? locationTypeKey,
                  pickupLabel:
                    typeof location.pickup_label === "string" && location.pickup_label.trim()
                      ? location.pickup_label.trim()
                      : fallback?.pickupLabel ?? locationTypeKey,
                  dropoffLabel:
                    typeof location.dropoff_label === "string" && location.dropoff_label.trim()
                      ? location.dropoff_label.trim()
                      : fallback?.dropoffLabel ?? locationTypeKey,
                  allowPickup: location.allow_pickup !== false,
                  allowDropoff: location.allow_dropoff !== false,
                  appliesToPickup: location.applies_to_pickup !== false,
                  appliesToDropoff: location.applies_to_dropoff !== false,
                  isActive: location.is_active !== false,
                  sortOrder:
                    typeof location.sort_order === "number"
                      ? Math.round(location.sort_order)
                      : fallback?.sortOrder ?? 0,
                  fieldSchema: Array.isArray(location.field_schema)
                    ? location.field_schema
                        .map((field) => {
                          if (!field || typeof field !== "object") return null;
                          const record = field as {
                            key?: unknown;
                            label?: unknown;
                            input_type?: unknown;
                            required?: unknown;
                            applies_to?: unknown;
                            default_source?: unknown;
                          };
                          if (
                            typeof record.key !== "string" ||
                            typeof record.label !== "string" ||
                            (record.input_type !== "text" &&
                              record.input_type !== "date" &&
                              record.input_type !== "time") ||
                            (record.applies_to !== "pickup" &&
                              record.applies_to !== "dropoff" &&
                              record.applies_to !== "both")
                          ) {
                            return null;
                          }
                          return {
                            key: record.key,
                            label: record.label,
                            inputType: record.input_type,
                            required: record.required === true,
                            appliesTo: record.applies_to,
                            defaultSource:
                              record.default_source === "pickup_date" ||
                              record.default_source === "pickup_time" ||
                              record.default_source === "dropoff_date" ||
                              record.default_source === "dropoff_time"
                                ? record.default_source
                                : null,
                          } satisfies BookingLocationFieldSchema;
                        })
                        .filter((field): field is BookingLocationFieldSchema => field !== null)
                    : fallback?.fieldSchema ?? [],
                  dbBacked: location.db_backed === true || (typeof location.id === "string" && location.id.trim().length > 0),
                } satisfies BookingLocationConfig;
              })
              .filter((location): location is BookingLocationConfig => location !== null)
              .sort((left, right) => left.sortOrder - right.sortOrder)
          : [];
        const canonicalLocations = nextLocations.length > 0 ? nextLocations : DEFAULT_BOOKING_LOCATIONS;
        setLocations(canonicalLocations);
        setPickupLocationTypeKey((current) =>
          canonicalLocations.some((location) => location.locationTypeKey === current)
            ? current
            : (canonicalLocations.find((location) => location.allowPickup)?.locationTypeKey ?? "OFFICE"),
        );
        setDropoffLocationTypeKey((current) =>
          canonicalLocations.some((location) => location.locationTypeKey === current)
            ? current
            : (canonicalLocations.find((location) => location.allowDropoff)?.locationTypeKey ?? "OFFICE"),
        );
      } catch (requestError) {
        if (cancelled) return;
        setLocations(DEFAULT_BOOKING_LOCATIONS);
        setPickupLocationTypeKey("OFFICE");
        setDropoffLocationTypeKey("OFFICE");
        setLocationsError(
          requestError instanceof Error ? requestError.message : "Unable to load pickup locations.",
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
    if (!open) return;
    if (!datesValid) {
      setAvailableVehicles([]);
      setVehiclesError(null);
      setVehiclesLoading(false);
      setVehicleId("");
      return;
    }

    let cancelled = false;

    async function loadVehicles() {
      setVehiclesLoading(true);
      setVehiclesError(null);

      try {
        const params = new URLSearchParams({ startDate, endDate });
        const response = await fetch(`/api/admin/bookings/available-vehicles?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          vehicles?: unknown[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load available vehicles.");
        }

        if (cancelled) return;
        const nextVehicles = Array.isArray(payload.vehicles)
          ? payload.vehicles.filter(
              (value): value is VehicleOption =>
                Boolean(value) &&
                typeof value === "object" &&
                typeof (value as { id?: unknown }).id === "string" &&
                typeof (value as { label?: unknown }).label === "string",
            )
          : [];

        setAvailableVehicles(nextVehicles);
        setVehicleId((current) =>
          current && nextVehicles.some((vehicle) => vehicle.id === current) ? current : "",
        );
      } catch (requestError) {
        if (cancelled) return;
        setAvailableVehicles([]);
        setVehicleId("");
        setVehiclesError(
          requestError instanceof Error ? requestError.message : "Unable to load available vehicles.",
        );
      } finally {
        if (!cancelled) {
          setVehiclesLoading(false);
        }
      }
    }

    void loadVehicles();

    return () => {
      cancelled = true;
    };
  }, [datesValid, endDate, open, startDate]);

  useEffect(() => {
    if (!open || !vehicleId) {
      setInsuranceOption({
        enabled: false,
        planId: null,
        pricePerDayCents: 0,
        coverageCents: 0,
      });
      setInsuranceError(null);
      setInsuranceLoading(false);
      setProtectionChoice("");
      return;
    }

    let cancelled = false;

    async function loadInsurance() {
      setInsuranceLoading(true);
      setInsuranceError(null);

      try {
        const response = await fetch(
          `/api/public/insurance?vehicleId=${encodeURIComponent(vehicleId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          insurance?: InsuranceOption;
          error?: string;
        };
        if (!response.ok || !payload.insurance) {
          throw new Error(payload.error ?? "Unable to load insurance options.");
        }

        if (cancelled) return;
        setInsuranceOption(payload.insurance);
        setProtectionChoice("");
      } catch (requestError) {
        if (cancelled) return;
        setInsuranceOption({
          enabled: false,
          planId: null,
          pricePerDayCents: 0,
          coverageCents: 0,
        });
        setProtectionChoice("");
        setInsuranceError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load insurance options.",
        );
      } finally {
        if (!cancelled) {
          setInsuranceLoading(false);
        }
      }
    }

    void loadInsurance();

    return () => {
      cancelled = true;
    };
  }, [open, vehicleId]);

  useEffect(() => {
    if (!open || !datesValid || !vehicleId || !protectionChoice) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;

    async function loadPreview() {
      setPreviewLoading(true);
      setPreviewError(null);

      try {
        const params = new URLSearchParams({
          vehicleId,
          startDate,
          endDate,
          insuranceSelected: String(protectionChoice === "STANDARD"),
        });
        if (protectionChoice === "STANDARD" && insuranceOption.planId) {
          params.set("insurancePlanId", insuranceOption.planId);
        }
        if (appliedPromoCode) {
          params.set("promoCode", appliedPromoCode);
        }
        if (selectedCustomerId) {
          params.set("customerId", selectedCustomerId);
        }
        if (email.trim()) {
          params.set("customerEmail", email.trim().toLowerCase());
        }
        const response = await fetch(`/api/admin/bookings/preview?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          preview?: PricingPreview;
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.preview) {
          throw new Error(payload.error ?? "Unable to preview booking total.");
        }

        if (cancelled) return;
        setPreview(payload.preview);
      } catch (requestError) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(
          requestError instanceof Error ? requestError.message : "Unable to preview booking total.",
        );
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [
    appliedPromoCode,
    datesValid,
    email,
    endDate,
    insuranceOption.planId,
    open,
    protectionChoice,
    selectedCustomerId,
    startDate,
    vehicleId,
  ]);

  useEffect(() => {
    if (!preview) {
      if (!paymentAmountManuallyEdited) {
        setPaymentAmount("");
      }
      return;
    }

    if (recordPaymentNow && !paymentAmountManuallyEdited) {
      setPaymentAmount(suggestedPaymentAmount);
    }
  }, [paymentAmountManuallyEdited, preview, recordPaymentNow, suggestedPaymentAmount]);

  useEffect(() => {
    setPickupLocationValues((current) =>
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
      setDropoffLocationValues((current) =>
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
      selectedPickupLocation && dropoffLocations.some((location) => location.locationTypeKey === selectedPickupLocation.locationTypeKey)
        ? selectedPickupLocation.locationTypeKey
        : (dropoffLocations[0]?.locationTypeKey ?? selectedPickupLocation?.locationTypeKey ?? "OFFICE");
    setDropoffLocationTypeKey(nextTypeKey);
    setDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffLocations, nextTypeKey, "dropoff"),
        "dropoff",
        selectedPickupLocation?.locationTypeKey === nextTypeKey && pickupLocationValues.address
          ? { address: pickupLocationValues.address }
          : {},
        locationDefaultsContext,
      ),
    );
  }, [
    dropoffLocationManuallyEdited,
    dropoffLocations,
    locationDefaultsContext,
    pickupLocationValues.address,
    selectedDropoffLocation,
    selectedPickupLocation,
  ]);

  function handleStartDateChange(nextStartDate: string) {
    setStartDate(nextStartDate);
    const suggestedEndDate = suggestAdminCreateBookingEndDate(nextStartDate);
    if (!suggestedEndDate) return;

    if (!endDateManuallyEdited || !endDate || endDate <= nextStartDate) {
      setEndDate(suggestedEndDate);
      setEndDateManuallyEdited(false);
    }
  }

  function handleEndDateChange(nextEndDate: string) {
    setEndDate(nextEndDate);
    setEndDateManuallyEdited(true);
  }

  function handlePickupLocationChange(nextTypeKey: string) {
    setPickupLocationTypeKey(nextTypeKey);
    setPickupLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(pickupLocations, nextTypeKey, "pickup"),
        "pickup",
        pickupLocationValues,
        locationDefaultsContext,
      ),
    );
  }

  function handleDropoffLocationChange(nextTypeKey: string) {
    setDropoffLocationTypeKey(nextTypeKey);
    setDropoffLocationManuallyEdited(true);
    setDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffLocations, nextTypeKey, "dropoff"),
        "dropoff",
        dropoffLocationValues,
        locationDefaultsContext,
      ),
    );
  }

  function handleMatchPickup() {
    const nextTypeKey =
      selectedPickupLocation?.locationTypeKey &&
      dropoffLocations.some((location) => location.locationTypeKey === selectedPickupLocation.locationTypeKey)
        ? selectedPickupLocation.locationTypeKey
        : (dropoffLocations[0]?.locationTypeKey ?? "OFFICE");
    setDropoffLocationManuallyEdited(false);
    setDropoffLocationTypeKey(nextTypeKey);
    setDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffLocations, nextTypeKey, "dropoff"),
        "dropoff",
        pickupLocationValues.address ? { address: pickupLocationValues.address } : {},
        locationDefaultsContext,
      ),
    );
  }

  function handleRecordPaymentNowChange(checked: boolean) {
    setRecordPaymentNow(checked);
    if (!checked) return;

    if (!preview) {
      if (!paymentAmountManuallyEdited) {
        setPaymentAmount("");
      }
      return;
    }

    if (!paymentAmountManuallyEdited || !paymentAmount.trim()) {
      setPaymentAmount(suggestedPaymentAmount);
      setPaymentAmountManuallyEdited(false);
    }
  }

  function handlePaymentAmountChange(nextPaymentAmount: string) {
    setPaymentAmount(nextPaymentAmount);
    setPaymentAmountManuallyEdited(true);
  }

  function handleApplyPromo() {
    const normalizedCode = promoCodeInput.trim().toUpperCase();
    if (!normalizedCode) {
      setPreviewError("Enter a promo code.");
      return;
    }
    setPreviewError(null);
    setAppliedPromoCode(normalizedCode);
    setPromoCodeInput(normalizedCode);
  }

  function handleClearPromo() {
    setAppliedPromoCode("");
    setPromoCodeInput("");
    setPreviewError(null);
  }

  function updatePickupLocationValue(fieldKey: string, value: string) {
    setPickupLocationValues((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  }

  function updateDropoffLocationValue(fieldKey: string, value: string) {
    setDropoffLocationManuallyEdited(true);
    setDropoffLocationValues((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setPaymentWarning(null);
    setCreatedBookingId(null);

    if (!protectionChoice) {
      setError("Select No Protection or Standard Protection.");
      setLoading(false);
      return;
    }

    const csrfToken = await ensureCsrfToken();
    const pickupLocationError = validateBookingLocationSelection(
      selectedPickupLocation,
      "pickup",
      pickupLocationValues,
    );
    if (pickupLocationError) {
      setError(pickupLocationError);
      setLoading(false);
      return;
    }

    const dropoffLocationError = validateBookingLocationSelection(
      selectedDropoffLocation,
      "dropoff",
      dropoffLocationValues,
    );
    if (dropoffLocationError) {
      setError(dropoffLocationError);
      setLoading(false);
      return;
    }

    const locationSelection = buildBookingLocationSelectionPayload({
      configs: locations,
      pickupTypeKey: pickupLocationTypeKey,
      dropoffTypeKey: dropoffLocationTypeKey,
      pickupLocationId: selectedPickupLocation?.id ?? null,
      dropoffLocationId: selectedDropoffLocation?.id ?? null,
      pickupValues: pickupLocationValues,
      dropoffValues: dropoffLocationValues,
      context: locationDefaultsContext,
    });

    const response = await fetch("/api/admin/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        vehicleId,
        customerId: selectedCustomerId || undefined,
        fullName,
        email,
        phone,
        startDate,
        endDate,
        pickupLocation: locationSelection.pickupLocationTextSnapshot,
        dropoffLocation: locationSelection.dropoffLocationTextSnapshot,
        pickupLocationType: locationSelection.pickupConfig?.locationTypeKey ?? pickupLocationTypeKey,
        dropoffLocationType: locationSelection.dropoffConfig?.locationTypeKey ?? dropoffLocationTypeKey,
        pickupLocationId: locationSelection.pickupConfig?.id ?? null,
        dropoffLocationId: locationSelection.dropoffConfig?.id ?? null,
        pickupLocationTextSnapshot: locationSelection.pickupLocationTextSnapshot,
        dropoffLocationTextSnapshot: locationSelection.dropoffLocationTextSnapshot,
        bookingLocationDetails: locationSelection.details,
        insuranceSelected: protectionChoice === "STANDARD",
        insurancePlanId:
          protectionChoice === "STANDARD" ? insuranceOption.planId : null,
        promoCode: appliedPromoCode || null,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Unable to create booking.");
      setLoading(false);
      return;
    }

    const bookingId = data.bookingId as string;
    setCreatedBookingId(bookingId);

    if (recordPaymentNow) {
      const numericAmount = Number(paymentAmount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        setError("Enter a valid payment amount to record payment now.");
        setLoading(false);
        return;
      }

      const paidAtDate = paymentDateTime ? new Date(paymentDateTime) : null;
      const paidAtIso =
        paidAtDate && !Number.isNaN(paidAtDate.getTime()) ? paidAtDate.toISOString() : undefined;

      const paymentResponse = await fetch(`/api/admin/bookings/${bookingId}/add-payment`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          amount: numericAmount,
          method: paymentMethod,
          reference: paymentReference.trim() || undefined,
          note: paymentNote.trim() || undefined,
          paidAt: paidAtIso,
        }),
      });

      if (!paymentResponse.ok) {
        const paymentData = await paymentResponse.json().catch(() => ({}));
        setPaymentWarning(paymentData.error ?? "Booking created, but payment could not be recorded.");
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    setOpen(false);
    router.push(`/admin/bookings/${bookingId}`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        Create booking
      </button>

      <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={closeModal}
        />
        <div
          className={`absolute right-0 top-0 h-full w-full max-w-xl border-l border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-2xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Create booking"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--ccr-border)] px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Create Booking
                </p>
                <h3 className="mt-1 text-lg font-bold text-[var(--ccr-text)]">
                  Add a booking in admin
                </h3>
                {selectedCustomerId ? (
                  <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                    Booking on behalf of existing customer
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4">
                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Start date
                    <input
                      value={startDate}
                      onChange={(event) => handleStartDateChange(event.target.value)}
                      type="date"
                      min={todayIso()}
                      required
                      className="promo-date-time-input date-icon-edge mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    End date
                    <input
                      value={endDate}
                      onChange={(event) => handleEndDateChange(event.target.value)}
                      type="date"
                      min={startDate || todayIso()}
                      required
                      className="promo-date-time-input date-icon-edge mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-[var(--ccr-muted)]">
                      Pickup location
                      <select
                        value={pickupLocationTypeKey}
                        onChange={(event) => {
                          handlePickupLocationChange(event.target.value);
                        }}
                        required
                        disabled={locationsLoading || pickupLocations.length === 0}
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
                      >
                        {pickupLocations.map((location) => (
                          <option key={location.locationTypeKey} value={location.locationTypeKey}>
                            {location.pickupLabel}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-[var(--ccr-muted)]">
                          Return location
                        </label>
                        {dropoffLocationManuallyEdited ? (
                          <button
                            type="button"
                            onClick={handleMatchPickup}
                            className={buttonStyles({ variant: "ghost", size: "sm" })}
                          >
                            Match pickup
                          </button>
                        ) : null}
                      </div>
                      <select
                        value={dropoffLocationTypeKey}
                        onChange={(event) => handleDropoffLocationChange(event.target.value)}
                        required
                        disabled={locationsLoading || dropoffLocations.length === 0}
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
                      >
                        {dropoffLocations.map((location) => (
                          <option key={location.locationTypeKey} value={location.locationTypeKey}>
                            {location.dropoffLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {pickupFieldSchema.length > 0 || dropoffFieldSchema.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-3">
                        {pickupFieldSchema.map((field) => (
                          <label
                            key={`pickup-${field.appliesTo}-${field.key}-${field.label}`}
                            className="block text-xs text-[var(--ccr-muted)]"
                          >
                            {field.label}
                            <input
                              value={pickupLocationValues[field.key] ?? ""}
                              onChange={(event) =>
                                updatePickupLocationValue(field.key, event.target.value)
                              }
                              type={field.inputType}
                              placeholder={field.inputType === "text" ? "Enter a value" : undefined}
                              className={`mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] ${
                                field.inputType === "date"
                                  ? "promo-date-time-input date-icon-edge"
                                  : field.inputType === "time"
                                    ? "promo-date-time-input"
                                    : ""
                              }`}
                            />
                          </label>
                        ))}
                      </div>

                      <div className="space-y-3">
                        {dropoffFieldSchema.map((field) => (
                          <label
                            key={`dropoff-${field.appliesTo}-${field.key}-${field.label}`}
                            className="block text-xs text-[var(--ccr-muted)]"
                          >
                            {field.label}
                            <input
                              value={dropoffLocationValues[field.key] ?? ""}
                              onChange={(event) =>
                                updateDropoffLocationValue(field.key, event.target.value)
                              }
                              type={field.inputType}
                              placeholder={field.inputType === "text" ? "Enter a value" : undefined}
                              className={`mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] ${
                                field.inputType === "date"
                                  ? "promo-date-time-input date-icon-edge"
                                  : field.inputType === "time"
                                    ? "promo-date-time-input"
                                    : ""
                              }`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {locationsError ? <p className="text-xs text-red-600">{locationsError}</p> : null}
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Vehicle
                    <select
                      value={vehicleId}
                      onChange={(event) => setVehicleId(event.target.value)}
                      required
                      disabled={!datesValid || vehiclesLoading || availableVehicles.length === 0}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
                    >
                      <option value="">
                        {!datesValid
                          ? "Select dates first"
                          : vehiclesLoading
                            ? "Loading available vehicles..."
                            : availableVehicles.length === 0
                              ? "No vehicles available for selected dates"
                              : "Select vehicle"}
                      </option>
                      {availableVehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!datesValid ? (
                    <p className="text-xs text-[var(--ccr-muted)]">
                      Choose a valid start and end date before loading available vehicles.
                    </p>
                  ) : null}
                  {vehiclesError ? <p className="text-xs text-red-600">{vehiclesError}</p> : null}
                  {!vehiclesLoading && datesValid && availableVehicles.length === 0 && !vehiclesError ? (
                    <p className="text-xs text-[var(--ccr-muted)]">
                      Vehicles with overlapping deposit-paid bookings or blockouts are excluded automatically.
                    </p>
                  ) : null}
                </section>

                <section className="grid gap-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Insurance coverage
                    </p>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      Select a coverage option before creating the booking.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setProtectionChoice("NONE")}
                      aria-pressed={protectionChoice === "NONE"}
                      className={`min-h-24 rounded-lg border p-3 text-left ${
                        protectionChoice === "NONE"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-[var(--ccr-text)]">
                        No Protection
                      </span>
                      <span className="mt-2 block text-lg font-bold text-[var(--ccr-text)]">
                        {formatJmd(0)}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--ccr-muted)]">
                        No additional charge
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProtectionChoice("STANDARD")}
                      disabled={insuranceLoading || !insuranceOption.enabled}
                      aria-pressed={protectionChoice === "STANDARD"}
                      className={`min-h-24 rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                        protectionChoice === "STANDARD"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-[var(--ccr-text)]">
                        Standard Protection
                      </span>
                      <span className="mt-2 block text-lg font-bold text-[var(--ccr-text)]">
                        {insuranceLoading
                          ? "Loading..."
                          : insuranceOption.enabled
                            ? `${formatJmd(insuranceOption.pricePerDayCents)} / day`
                            : "Not configured"}
                      </span>
                      {insuranceOption.enabled && insuranceOption.coverageCents > 0 ? (
                        <span className="mt-1 block text-xs text-[var(--ccr-muted)]">
                          Coverage: {formatJmd(insuranceOption.coverageCents)}
                        </span>
                      ) : null}
                    </button>
                  </div>
                  {insuranceError ? <p className="text-xs text-red-600">{insuranceError}</p> : null}
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Promo code
                    </p>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      Promo rules are validated against this customer, vehicle, and rental window.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={promoCodeInput}
                      onChange={(event) => setPromoCodeInput(event.target.value.toUpperCase())}
                      type="text"
                      placeholder="Enter promo code"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                    <button
                      type="button"
                      onClick={handleApplyPromo}
                      className={buttonStyles({ variant: "secondary", size: "sm" })}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={handleClearPromo}
                      disabled={!promoCodeInput && !appliedPromoCode}
                      className={buttonStyles({ variant: "ghost", size: "sm" })}
                    >
                      Clear
                    </button>
                  </div>
                  {appliedPromoCode &&
                  !previewLoading &&
                  !previewError &&
                  preview?.promoCode === appliedPromoCode ? (
                    <p className="text-xs font-semibold text-[var(--ccr-text)]">
                      Applied to preview: {appliedPromoCode}
                    </p>
                  ) : appliedPromoCode && previewLoading ? (
                    <p className="text-xs font-semibold text-[var(--ccr-muted)]">
                      Validating promo: {appliedPromoCode}
                    </p>
                  ) : null}
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)] sm:col-span-2">
                    Full name
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      type="text"
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>

                  <label className="text-xs text-[var(--ccr-muted)]">
                    Email
                    <input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Phone
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      type="text"
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                    <input
                      checked={recordPaymentNow}
                      onChange={(event) => handleRecordPaymentNowChange(event.target.checked)}
                      type="checkbox"
                      className="h-4 w-4 rounded border-[var(--ccr-border)] bg-[var(--ccr-bg)] accent-[var(--ccr-accent)]"
                    />
                    Record payment now
                  </label>

                  {recordPaymentNow ? (
                    <div className="grid gap-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
                      <label className="text-xs text-[var(--ccr-muted)]">
                        Payment amount (JMD)
                        <input
                          value={paymentAmount}
                          onChange={(event) => handlePaymentAmountChange(event.target.value)}
                          type="number"
                          min="0"
                          step="0.01"
                          required={recordPaymentNow}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                        />
                      </label>

                      <label className="text-xs text-[var(--ccr-muted)]">
                        Payment method
                        <select
                          value={paymentMethod}
                          onChange={(event) => setPaymentMethod(event.target.value as PaymentMethodValue)}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                        >
                          {PAYMENT_METHODS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs text-[var(--ccr-muted)]">
                        Payment date/time
                        <input
                          value={paymentDateTime}
                          onChange={(event) => setPaymentDateTime(event.target.value)}
                          type="datetime-local"
                          required={recordPaymentNow}
                          className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                        />
                      </label>

                      <label className="text-xs text-[var(--ccr-muted)]">
                        Reference / receipt # (optional)
                        <input
                          value={paymentReference}
                          onChange={(event) => setPaymentReference(event.target.value)}
                          type="text"
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                        />
                      </label>

                      <label className="text-xs text-[var(--ccr-muted)]">
                        Notes (optional)
                        <textarea
                          value={paymentNote}
                          onChange={(event) => setPaymentNote(event.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                        />
                      </label>
                    </div>
                  ) : null}
                </section>

                <section
                  data-testid="admin-create-booking-total-preview"
                  className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Booking total preview
                    </p>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      Preview appears after dates and vehicle are selected. Final availability is still checked on submit.
                    </p>
                  </div>

                  {!vehicleId || !datesValid || !protectionChoice ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      Select valid dates, a vehicle, and insurance coverage to preview pricing.
                    </p>
                  ) : previewLoading ? (
                    <p className="text-sm text-[var(--ccr-muted)]">Calculating total…</p>
                  ) : previewError ? (
                    <p className="text-sm text-red-600">{previewError}</p>
                  ) : preview ? (
                    <dl className="grid gap-2 text-sm text-[var(--ccr-muted)] sm:grid-cols-2">
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Start date</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formattedPreviewStartDate}</dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>End date</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{formattedPreviewEndDate}</dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Days</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{preview.days}</dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Average daily rate</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.dailyRateCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Base rental</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.baseTotalCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Insurance</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.insuranceTotalCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Promo discount{preview.promoCode ? ` (${preview.promoCode})` : ""}</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          -{formatJmd(preview.promoDiscountCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Subtotal</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.subtotalCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Deposit required</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.depositRequiredCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Due now</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.dueNowCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2">
                        <dt>Balance on pickup</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.balanceDueCents)}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 sm:col-span-2">
                        <dt>Total</dt>
                        <dd className="text-base font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.totalCents)}
                        </dd>
                      </div>
                      {preview.rateBreakdown.length > 0 ? (
                        <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 sm:col-span-2">
                          <dt>Daily rate breakdown</dt>
                          <dd className="mt-2 grid gap-1">
                            {preview.rateBreakdown.map((rate) => (
                              <span
                                key={`${rate.date}-${rate.source}`}
                                className="flex justify-between gap-3 text-xs"
                              >
                                <span>{rate.date} · {rate.source.replace("_", " ")}</span>
                                <span className="font-semibold text-[var(--ccr-text)]">
                                  {formatJmd(rate.dailyRateCents)}
                                </span>
                              </span>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                </section>

                {error ? <p className="text-xs text-red-600">{error}</p> : null}
                {paymentWarning ? <p className="text-xs text-amber-500">{paymentWarning}</p> : null}
                {paymentWarning && createdBookingId ? (
                  <p className="text-xs text-[var(--ccr-muted)]">
                    Booking was created. Review it at{" "}
                    <a
                      href={`/admin/bookings/${createdBookingId}`}
                      className="font-semibold text-[var(--ccr-accent)] underline"
                    >
                      /admin/bookings/{createdBookingId}
                    </a>
                    .
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className={buttonStyles({ variant: "primary", size: "md" })}
                >
                  {loading ? "Creating..." : "Create booking"}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className={buttonStyles({ variant: "secondary", size: "md" })}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
