"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type BookingUpdateFormProps = {
  bookingId: string;
  startDate: string | Date;
  endDate: string | Date;
  pickupLocation: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  disabled?: boolean;
};

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

export function BookingUpdateForm({
  bookingId,
  startDate,
  endDate,
  pickupLocation,
  customerName,
  customerEmail,
  customerPhone,
  disabled,
}: BookingUpdateFormProps) {
  const router = useRouter();
  const startDateRef = useRef<HTMLInputElement | null>(null);
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [nextStartDate, setNextStartDate] = useState(toDateInputValue(startDate));
  const [nextEndDate, setNextEndDate] = useState(toDateInputValue(endDate));
  const [nextPickupLocation, setNextPickupLocation] = useState(pickupLocation);
  const [nextCustomerName, setNextCustomerName] = useState(customerName);
  const [nextCustomerEmail, setNextCustomerEmail] = useState(customerEmail);
  const [nextCustomerPhone, setNextCustomerPhone] = useState(customerPhone);

  function openPanel() {
    setNextStartDate(toDateInputValue(startDate));
    setNextEndDate(toDateInputValue(endDate));
    setNextPickupLocation(pickupLocation);
    setNextCustomerName(customerName);
    setNextCustomerEmail(customerEmail);
    setNextCustomerPhone(customerPhone);
    setError(null);
    setMessage(null);
    setOpen(true);
  }

  function openNativePicker(ref: React.RefObject<HTMLInputElement | null>) {
    const input = ref.current;
    if (!input) return;

    const pickerInput = input as HTMLInputElement & {
      showPicker?: () => void;
    };

    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fallback below for browsers or states where showPicker is blocked.
      }
    }

    input.focus();
    input.click();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || disabled) return;
    setLoading(true);
    setError(null);
    setMessage(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "update_details",
        startDate: nextStartDate,
        endDate: nextEndDate,
        pickupLocation: nextPickupLocation,
        customerName: nextCustomerName,
        customerEmail: nextCustomerEmail,
        customerPhone: nextCustomerPhone,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Unable to update booking");
      return;
    }

    setMessage(data.message ?? "Booking updated.");
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Booking changes
          </p>
          <h3 className="text-sm font-semibold text-[var(--ccr-text)]">
            Update or extend booking dates and customer info
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

      {open ? (
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
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

          <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
            Pickup location
            <input
              type="text"
              value={nextPickupLocation}
              onChange={(event) => setNextPickupLocation(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

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
              type="text"
              value={nextCustomerPhone}
              onChange={(event) => setNextCustomerPhone(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <div className="md:col-span-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className={buttonStyles({
                variant: "primary",
                size: "sm",
                className: "rounded-lg",
              })}
            >
              {loading ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setOpen(false)}
              className={buttonStyles({
                variant: "secondary",
                size: "sm",
                className: "rounded-lg",
              })}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {message ? <p className="mt-3 text-xs font-semibold text-[var(--ccr-text)]">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
