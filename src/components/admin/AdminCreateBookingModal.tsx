"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleOption = {
  id: string;
  label: string;
};

type AdminCreateBookingModalProps = {
  vehicles: VehicleOption[];
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

export function AdminCreateBookingModal({ vehicles }: AdminCreateBookingModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [recordPaymentNow, setRecordPaymentNow] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>("CASH");
  const [paymentDateTime, setPaymentDateTime] = useState(() => toDateTimeLocalValue(new Date()));
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentWarning, setPaymentWarning] = useState<string | null>(null);

  function closeModal() {
    if (loading) return;
    setOpen(false);
    setError(null);
    setPaymentWarning(null);
  }

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
  }, [open, loading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setPaymentWarning(null);

    const csrfToken = await ensureCsrfToken();

    const response = await fetch("/api/admin/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        vehicleId,
        fullName,
        email,
        phone,
        startDate,
        endDate,
        pickupLocation,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Unable to create booking.");
      setLoading(false);
      return;
    }

    const bookingId = data.bookingId as string;

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
        className="rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ring-1 ring-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface-soft)]"
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
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-3">
                <label className="text-xs text-[var(--ccr-muted)]">
                  Vehicle
                  <select
                    value={vehicleId}
                    onChange={(event) => setVehicleId(event.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Start date
                    <input
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      type="date"
                      min={todayIso()}
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    End date
                    <input
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                      type="date"
                      min={startDate || todayIso()}
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </div>

                <label className="text-xs text-[var(--ccr-muted)]">
                  Full name
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    type="text"
                    required
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Email
                    <input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--ccr-muted)]">
                    Phone
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      type="text"
                      required
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                    />
                  </label>
                </div>

                <label className="text-xs text-[var(--ccr-muted)]">
                  Pickup location
                  <input
                    value={pickupLocation}
                    onChange={(event) => setPickupLocation(event.target.value)}
                    type="text"
                    required
                    className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
                  <input
                    checked={recordPaymentNow}
                    onChange={(event) => setRecordPaymentNow(event.target.checked)}
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--ccr-border)] bg-[var(--ccr-bg)]"
                  />
                  Record payment now
                </label>

                {recordPaymentNow ? (
                  <div className="grid gap-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
                    <label className="text-xs text-[var(--ccr-muted)]">
                      Payment amount (JMD)
                      <input
                        value={paymentAmount}
                        onChange={(event) => setPaymentAmount(event.target.value)}
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
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
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

                {error ? <p className="text-xs text-red-600">{error}</p> : null}
                {paymentWarning ? <p className="text-xs text-amber-500">{paymentWarning}</p> : null}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {loading ? "Creating..." : "Create booking"}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
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
