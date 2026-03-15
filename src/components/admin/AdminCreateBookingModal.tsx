"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import {
  suggestAdminCreateBookingEndDate,
  suggestAdminCreateBookingPaymentAmount,
} from "@/lib/bookings/adminCreateBookingDates";
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

type LocationOption = {
  id: string;
  label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  is_active?: boolean;
};

type PricingPreview = {
  days: number;
  dailyRateCents: number;
  subtotalCents: number;
  promoDiscountCents: number;
  totalCents: number;
  depositRequiredCents: number;
  currency: "JMD";
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

function isDateRangeValid(startDate: string, endDate: string) {
  return startDate.length > 0 && endDate.length > 0 && endDate > startDate;
}

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
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
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

  const [locations, setLocations] = useState<LocationOption[]>([]);
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

  const datesValid = useMemo(() => isDateRangeValid(startDate, endDate), [endDate, startDate]);
  const pickupLocations = useMemo(
    () => locations.filter((location) => location.allow_pickup && location.is_active !== false),
    [locations],
  );
  const selectedPickupLocation = useMemo(
    () => pickupLocations.find((location) => location.id === pickupLocationId) ?? null,
    [pickupLocationId, pickupLocations],
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
          ? payload.locations.filter(
              (value): value is LocationOption =>
                Boolean(value) &&
                typeof value === "object" &&
                typeof (value as { id?: unknown }).id === "string" &&
                typeof (value as { label?: unknown }).label === "string",
            )
          : [];
        setLocations(nextLocations);
        setPickupLocationId((current) =>
          current && nextLocations.some((location) => location.id === current)
            ? current
            : (nextLocations.find((location) => location.allow_pickup && location.is_active !== false)?.id ?? ""),
        );
      } catch (requestError) {
        if (cancelled) return;
        setLocations([]);
        setPickupLocationId("");
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
    if (!open || !datesValid || !vehicleId) {
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
        const params = new URLSearchParams({ vehicleId, startDate, endDate });
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
  }, [datesValid, endDate, open, startDate, vehicleId]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setPaymentWarning(null);
    setCreatedBookingId(null);

    const csrfToken = await ensureCsrfToken();

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
        pickupLocation: selectedPickupLocation?.label ?? "",
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
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
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
                      className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </section>

                <section className="grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Pickup location
                    <select
                      value={pickupLocationId}
                      onChange={(event) => setPickupLocationId(event.target.value)}
                      required
                      disabled={locationsLoading || pickupLocations.length === 0}
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
                    >
                      <option value="">
                        {locationsLoading ? "Loading pickup locations..." : "Select pickup location"}
                      </option>
                      {pickupLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.label}
                        </option>
                      ))}
                    </select>
                  </label>
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

                  {!vehicleId || !datesValid ? (
                    <p className="text-sm text-[var(--ccr-muted)]">
                      Select valid dates and a vehicle to preview pricing.
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
                        <dt>Daily rate</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.dailyRateCents)}
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
                      <div className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 sm:col-span-2">
                        <dt>Total</dt>
                        <dd className="text-base font-semibold text-[var(--ccr-text)]">
                          {formatJmd(preview.totalCents)}
                        </dd>
                      </div>
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
