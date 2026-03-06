"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LEGAL_ID_TYPES, formatLegalIdTypeLabel } from "@/lib/customers/legalId";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

export function CreateCustomerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("");
  const [birthday, setBirthday] = useState("");
  const [driversLicenseNumber, setDriversLicenseNumber] = useState("");
  const [legalIdType, setLegalIdType] = useState<(typeof LEGAL_ID_TYPES)[number]>("TRN");
  const [legalIdNumber, setLegalIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        street,
        street2,
        city,
        state,
        zip,
        country,
        birthday: birthday || null,
        driversLicenseNumber,
        legalIdType,
        legalIdNumber,
        address,
        notes,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      customer?: { id: string; full_name: string };
    };

    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Unable to create customer.");
      return;
    }

    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setStreet("");
    setStreet2("");
    setCity("");
    setState("");
    setZip("");
    setCountry("");
    setBirthday("");
    setDriversLicenseNumber("");
    setLegalIdType("TRN");
    setLegalIdNumber("");
    setAddress("");
    setNotes("");
    setMessage(data.customer ? `Customer created: ${data.customer.full_name}` : "Customer created.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          setError(null);
          setOpen(true);
        }}
        className={buttonStyles({
          variant: "secondary",
          size: "sm",
          className:
            "inline-flex w-full items-center justify-center border-[var(--ccr-accent)] ring-1 ring-[var(--ccr-accent)] sm:w-auto",
        })}
      >
        New customer
      </button>

      {message ? (
        <p className="sr-only" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 py-8 md:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Create customer"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--ccr-text)]">Add walk-in customer</h2>
                <p className="text-sm text-[var(--ccr-muted)]">
                  Create a full customer profile for walk-ins and admin-entered bookings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={buttonStyles({ variant: "secondary", size: "xs" })}
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-[var(--ccr-muted)]">
                First name
                <input
                  type="text"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Last name
                <input
                  type="text"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Phone
                <input
                  type="text"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Street
                <input
                  type="text"
                  value={street}
                  onChange={(event) => setStreet(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Street 2
                <input
                  type="text"
                  value={street2}
                  onChange={(event) => setStreet2(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                City
                <input
                  type="text"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                State
                <input
                  type="text"
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                ZIP
                <input
                  type="text"
                  value={zip}
                  onChange={(event) => setZip(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Country
                <input
                  type="text"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Birthday
                <input
                  type="date"
                  value={birthday}
                  onChange={(event) => setBirthday(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Driver&apos;s license number
                <input
                  type="text"
                  value={driversLicenseNumber}
                  onChange={(event) => setDriversLicenseNumber(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Legal ID type
                <select
                  value={legalIdType}
                  onChange={(event) => setLegalIdType(event.target.value as (typeof LEGAL_ID_TYPES)[number])}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  {LEGAL_ID_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatLegalIdTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--ccr-muted)]">
                Legal ID number
                <input
                  type="text"
                  value={legalIdNumber}
                  onChange={(event) => setLegalIdNumber(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
                Address
                <input
                  type="text"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
              <label className="text-xs text-[var(--ccr-muted)] md:col-span-2">
                Notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            </div>

            {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={loading}
                className={buttonStyles({ variant: "primary", size: "sm" })}
              >
                {loading ? "Creating..." : "Create customer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
