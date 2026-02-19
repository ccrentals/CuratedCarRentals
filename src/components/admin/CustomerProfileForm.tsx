"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { LEGAL_ID_TYPES, formatLegalIdTypeLabel } from "@/lib/customers/legalId";

type CustomerProfileFormProps = {
  customerId: string;
  fullName: string;
  email: string;
  phone: string;
  legalIdType: string | null;
  legalIdNumber: string | null;
  legalIdImageUrl: string | null;
  address: string | null;
  notes: string | null;
};

export function CustomerProfileForm({
  customerId,
  fullName,
  email,
  phone,
  legalIdType,
  legalIdNumber,
  legalIdImageUrl,
  address,
  notes,
}: CustomerProfileFormProps) {
  const router = useRouter();
  const legalIdInputRef = useRef<HTMLInputElement | null>(null);
  const uploadcarePublicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";
  const [nextFullName, setNextFullName] = useState(fullName);
  const [nextEmail, setNextEmail] = useState(email);
  const [nextPhone, setNextPhone] = useState(phone);
  const [nextLegalIdType, setNextLegalIdType] = useState(legalIdType ?? "TRN");
  const [nextLegalIdNumber, setNextLegalIdNumber] = useState(legalIdNumber ?? "");
  const [nextLegalIdImageUrl, setNextLegalIdImageUrl] = useState(legalIdImageUrl ?? "");
  const [nextAddress, setNextAddress] = useState(address ?? "");
  const [nextNotes, setNextNotes] = useState(notes ?? "");
  const [uploadingLegalId, setUploadingLegalId] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLegalIdImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!uploadcarePublicKey.trim()) {
      setError("Uploadcare is not configured. Add NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY.");
      return;
    }

    setError(null);
    setUploadingLegalId(true);
    try {
      const formData = new FormData();
      formData.set("UPLOADCARE_PUB_KEY", uploadcarePublicKey.trim());
      formData.set("UPLOADCARE_STORE", "1");
      formData.set("file", file);

      const uploadResponse = await fetch("https://upload.uploadcare.com/base/", {
        method: "POST",
        body: formData,
      });
      const uploadPayload = (await uploadResponse
        .json()
        .catch(() => null)) as { file?: unknown; error?: { content?: unknown } } | null;

      if (!uploadResponse.ok || typeof uploadPayload?.file !== "string") {
        const providerMessage =
          typeof uploadPayload?.error?.content === "string"
            ? uploadPayload.error.content
            : "Upload failed";
        throw new Error(providerMessage);
      }

      setNextLegalIdImageUrl(`https://ucarecdn.com/${uploadPayload.file}/`);
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Unable to upload ID image.";
      setError(message);
    } finally {
      setUploadingLegalId(false);
    }
  }

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
    if (uploadingLegalId) {
      setError("Please wait until image upload finishes.");
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
        legalIdImageUrl: nextLegalIdImageUrl,
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
      <div className="text-xs text-[var(--ccr-muted)]">
        Legal ID Image
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => legalIdInputRef.current?.click()}
            disabled={uploadingLegalId}
            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {uploadingLegalId ? "Uploading..." : "Use camera / upload image"}
          </button>
          {nextLegalIdImageUrl ? (
            <>
              <a
                href={nextLegalIdImageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-[var(--ccr-accent)] underline"
              >
                View image
              </a>
              <button
                type="button"
                onClick={() => setNextLegalIdImageUrl("")}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
              >
                Remove
              </button>
            </>
          ) : null}
        </div>
        <input
          ref={legalIdInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleLegalIdImageChange}
          className="hidden"
        />
      </div>
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
