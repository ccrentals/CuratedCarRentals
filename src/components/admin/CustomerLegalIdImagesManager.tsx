"use client";

import { ExternalLink, ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";

import { buttonStyles } from "@/components/ui/Button";
import type { CustomerPrivateFileItem } from "@/lib/customers/privateFiles";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { selectAndUploadDirectImages } from "@/lib/uploads/directUpload-client";

type Props = {
  customerId: string;
  initialItems: CustomerPrivateFileItem[];
  readOnly?: boolean;
  compact?: boolean;
};

function sourceLabel(item: CustomerPrivateFileItem) {
  if (item.source === "admin_customer_profile") return "Customer profile";
  if (item.source === "public_booking_wizard") return "Booking wizard";
  return item.bookingId ? "Booking" : "Customer profile";
}

function uploadedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Upload date unavailable" : date.toLocaleString();
}

export function CustomerLegalIdImagesManager({
  customerId,
  initialItems,
  readOnly = false,
  compact = false,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadImages() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const uploaded = await selectAndUploadDirectImages({
        purpose: "CUSTOMER_LEGAL_ID",
        entityId: customerId,
        onProgress: (progress) => {
          const phase = progress.phase === "authorizing"
            ? "Checking"
            : progress.phase === "finalizing"
              ? "Saving"
              : "Uploading";
          setMessage(
            `${phase} ${progress.fileIndex + 1} of ${progress.fileCount}: ${progress.fileName}${progress.phase === "uploading" ? ` (${progress.percent}%)` : ""}`,
          );
        },
      });
      const added = uploaded.map((entry) => entry.result as unknown as CustomerPrivateFileItem);
      if (added.length === 0) return;
      setItems((current) => [...added, ...current]);
      setMessage(
        added.length === 1
          ? "1 ID image added to the customer."
          : `${added.length} ID images added to the customer.`,
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload ID images.");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(item: CustomerPrivateFileItem) {
    if (!window.confirm("Remove this ID image from the customer?")) return;
    setRemovingId(item.id);
    setMessage(null);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(
        `/api/admin/customers/${customerId}/private-files/${item.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          credentials: "include",
          body: JSON.stringify({ csrfToken }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; cleanupWarning?: string | null }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to remove customer ID image.");
      }
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setMessage(payload?.cleanupWarning || "ID image removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove image.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className={compact ? "mt-3" : "mt-4"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--ccr-text)]">
            Driver&apos;s license images ({items.length})
          </p>
          {!readOnly ? (
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Upload front, back, or supporting ID images. Each image is privately tagged to this
              customer.
            </p>
          ) : null}
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => void uploadImages()}
            disabled={busy}
            className={buttonStyles({ variant: "secondary", size: "sm", className: "gap-2" })}
          >
            <ImagePlus aria-hidden="true" className="h-4 w-4" />
            {busy ? "Uploading..." : "Upload ID images"}
          </button>
        ) : null}
      </div>

      {message ? (
        <p className="mt-3 rounded-lg border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-xs text-[var(--ccr-status-success-text)]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-xs text-[var(--ccr-status-danger-text)]">
          {error}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <article
              key={item.id}
              className="min-w-0 overflow-hidden rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.openUrl}
                alt={`Driver's license image ${index + 1}`}
                className="aspect-[5/3] w-full bg-[var(--ccr-bg)] object-cover"
              />
              <div className="space-y-2 p-3">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p
                    className="truncate text-xs font-semibold text-[var(--ccr-text)]"
                    title={item.originalFileName || `License image ${index + 1}`}
                  >
                    {item.originalFileName || `License image ${index + 1}`}
                  </p>
                  {item.bookingPublicId ? (
                    <span className="shrink-0 rounded-full border border-[var(--ccr-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ccr-muted)]">
                      {item.bookingPublicId}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-[var(--ccr-muted)]">
                  {sourceLabel(item)} · {uploadedLabel(item.createdAt)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={item.openUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonStyles({
                      variant: "secondary",
                      size: "xs",
                      className: "gap-1.5",
                    })}
                  >
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    Open
                  </a>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => void removeImage(item)}
                      disabled={removingId === item.id}
                      className={buttonStyles({
                        variant: "danger",
                        size: "xs",
                        className: "gap-1.5",
                      })}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      {removingId === item.id ? "Removing..." : "Remove"}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--ccr-border)] px-3 py-4 text-xs text-[var(--ccr-muted)]">
          No driver&apos;s license images have been uploaded for this customer.
        </div>
      )}
    </div>
  );
}
