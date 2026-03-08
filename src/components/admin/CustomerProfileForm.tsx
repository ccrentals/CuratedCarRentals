"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { LEGAL_ID_TYPES, formatLegalIdTypeLabel } from "@/lib/customers/legalId";
import {
  JAMAICA_PARISHES,
  isJamaicaCountry,
  resolveStoredRegionCountry,
} from "@/lib/jamaicaParishes";

type CustomerProfileFormProps = {
  customerId: string;
  fullName: string;
  email: string;
  phone: string;
  legalIdType: string | null;
  legalIdNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  birthday: string | null;
  driversLicenseNumber: string | null;
  address: string | null;
  notes: string | null;
};

function normalizeDateInput(value: string | null) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export function CustomerProfileForm({
  customerId,
  fullName,
  email,
  phone,
  legalIdType,
  legalIdNumber,
  firstName,
  lastName,
  street,
  street2,
  city,
  state,
  country,
  birthday,
  driversLicenseNumber,
  address,
  notes,
}: CustomerProfileFormProps) {
  const router = useRouter();
  const [nextFullName, setNextFullName] = useState(fullName);
  const [nextEmail, setNextEmail] = useState(email);
  const [nextPhone, setNextPhone] = useState(phone);
  const [nextLegalIdType, setNextLegalIdType] = useState(legalIdType ?? "TRN");
  const [nextLegalIdNumber, setNextLegalIdNumber] = useState(legalIdNumber ?? "");
  const [nextFirstName, setNextFirstName] = useState(firstName ?? "");
  const [nextLastName, setNextLastName] = useState(lastName ?? "");
  const [nextStreet, setNextStreet] = useState(street ?? "");
  const [nextStreet2, setNextStreet2] = useState(street2 ?? "");
  const [nextCity, setNextCity] = useState(city ?? "");
  const normalizedAddressFields = resolveStoredRegionCountry(state, country);
  const [nextParish, setNextParish] = useState(normalizedAddressFields.region ?? "");
  const [nextCountry, setNextCountry] = useState(normalizedAddressFields.country ?? "Jamaica");
  const [nextBirthday, setNextBirthday] = useState(normalizeDateInput(birthday));
  const [nextDriversLicenseNumber, setNextDriversLicenseNumber] = useState(
    driversLicenseNumber ?? "",
  );
  const [nextAddress, setNextAddress] = useState(address ?? "");
  const [nextNotes, setNextNotes] = useState(notes ?? "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setMessage(null);
    setError(null);

    if (!nextLegalIdType.trim()) {
      setError("Select a legal ID type.");
      setLoading(false);
      return;
    }
    if (!nextLegalIdNumber.trim()) {
      setError("Enter the legal ID number.");
      setLoading(false);
      return;
    }
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        fullName: nextFullName,
        email: nextEmail,
        phone: nextPhone,
        legalIdType: nextLegalIdType,
        legalIdNumber: nextLegalIdNumber,
        firstName: nextFirstName,
        lastName: nextLastName,
        street: nextStreet,
        street2: nextStreet2,
        city: nextCity,
        parish: nextParish,
        country: nextCountry,
        birthday: nextBirthday || null,
        driversLicenseNumber: nextDriversLicenseNumber,
        address: nextAddress,
        notes: nextNotes,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Unable to update customer.");
      return;
    }

    setMessage("Customer profile updated.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block text-xs text-[var(--ccr-muted)]">
        Full name
        <input
          type="text"
          value={nextFullName}
          onChange={(event) => setNextFullName(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <label className="block text-xs text-[var(--ccr-muted)]">
        Email
        <input
          type="email"
          value={nextEmail}
          onChange={(event) => setNextEmail(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <label className="block text-xs text-[var(--ccr-muted)]">
        Phone
        <input
          type="text"
          value={nextPhone}
          onChange={(event) => setNextPhone(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-[var(--ccr-muted)]">
          First name
          <input
            type="text"
            value={nextFirstName}
            onChange={(event) => setNextFirstName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="block text-xs text-[var(--ccr-muted)]">
          Last name
          <input
            type="text"
            value={nextLastName}
            onChange={(event) => setNextLastName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
      </div>
      <label className="block text-xs text-[var(--ccr-muted)]">
        Driver&apos;s license number
        <input
          type="text"
          value={nextDriversLicenseNumber}
          onChange={(event) => setNextDriversLicenseNumber(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <label className="block text-xs text-[var(--ccr-muted)]">
        Legal ID Type
        <select
          value={nextLegalIdType}
          onChange={(event) => setNextLegalIdType(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        >
          {LEGAL_ID_TYPES.map((type) => (
            <option key={type} value={type}>
              {formatLegalIdTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-[var(--ccr-muted)]">
        TRN / Passport / Legal ID Number
        <input
          type="text"
          value={nextLegalIdNumber}
          onChange={(event) => setNextLegalIdNumber(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <label className="block text-xs text-[var(--ccr-muted)]">
        Address
        <textarea
          value={nextAddress}
          onChange={(event) => setNextAddress(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-[var(--ccr-muted)]">
          Street
          <input
            type="text"
            value={nextStreet}
            onChange={(event) => setNextStreet(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="block text-xs text-[var(--ccr-muted)]">
          Street 2
          <input
            type="text"
            value={nextStreet2}
            onChange={(event) => setNextStreet2(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="block text-xs text-[var(--ccr-muted)]">
          City
          <input
            type="text"
            value={nextCity}
            onChange={(event) => setNextCity(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="block text-xs text-[var(--ccr-muted)]">
          Parish / Region
          <input
            type="text"
            value={nextParish}
            onChange={(event) => setNextParish(event.target.value)}
            list="admin-customer-profile-parish-suggestions"
            placeholder={isJamaicaCountry(nextCountry) ? "e.g. St. Andrew" : "e.g. Ontario"}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
          <datalist id="admin-customer-profile-parish-suggestions">
            {JAMAICA_PARISHES.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label className="block text-xs text-[var(--ccr-muted)]">
          Country
          <input
            type="text"
            value={nextCountry}
            onChange={(event) => setNextCountry(event.target.value)}
            placeholder="Jamaica"
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
        <label className="block text-xs text-[var(--ccr-muted)]">
          Birthday
          <input
            type="date"
            value={nextBirthday}
            onChange={(event) => setNextBirthday(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
          />
        </label>
      </div>
      <label className="block text-xs text-[var(--ccr-muted)]">
        Admin notes
        <textarea
          value={nextNotes}
          onChange={(event) => setNextNotes(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading}
          className={buttonStyles({
            variant: "primary",
            size: "sm",
            className: "rounded-lg",
          })}
        >
          {loading ? "Saving..." : "Save profile"}
        </button>
        {message ? <p className="text-xs font-semibold text-[var(--ccr-text)]">{message}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </form>
  );
}
