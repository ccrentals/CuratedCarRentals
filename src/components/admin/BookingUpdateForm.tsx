"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {open ? "Close" : "Edit booking"}
        </button>
      </div>

      {open ? (
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="text-xs text-[var(--ccr-muted)]">
            Start date
            <input
              type="date"
              value={nextStartDate}
              onChange={(event) => setNextStartDate(event.target.value)}
              required
              className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs text-[var(--ccr-muted)]">
            End date
            <input
              type="date"
              value={nextEndDate}
              onChange={(event) => setNextEndDate(event.target.value)}
              min={nextStartDate}
              required
              className="promo-date-time-input mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
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
              className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setOpen(false)}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
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
