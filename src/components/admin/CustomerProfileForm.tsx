"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type CustomerProfileFormProps = {
  customerId: string;
  fullName: string;
  email: string;
  phone: string;
  address: string | null;
  notes: string | null;
};

export function CustomerProfileForm({
  customerId,
  fullName,
  email,
  phone,
  address,
  notes,
}: CustomerProfileFormProps) {
  const router = useRouter();
  const [nextFullName, setNextFullName] = useState(fullName);
  const [nextEmail, setNextEmail] = useState(email);
  const [nextPhone, setNextPhone] = useState(phone);
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
      <label className="block text-xs text-[var(--ccr-muted)]">
        Address
        <textarea
          value={nextAddress}
          onChange={(event) => setNextAddress(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm text-[var(--ccr-text)]"
        />
      </label>
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
          className="rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Saving..." : "Save profile"}
        </button>
        {message ? <p className="text-xs font-semibold text-[var(--ccr-text)]">{message}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </form>
  );
}
