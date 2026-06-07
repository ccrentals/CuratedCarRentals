"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type AdminMediaRemoveButtonProps = {
  removeUrl: string;
  removePayload: Record<string, string>;
  label: string;
};

export function AdminMediaRemoveButton({
  removeUrl,
  removePayload,
  label,
}: AdminMediaRemoveButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove ${label}? This uses the existing media removal rules.`)) return;
    setPending(true);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(removeUrl, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ ...removePayload, csrfToken }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; ok?: boolean }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to remove this image.");
      }
      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove this image.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => void remove()}
        disabled={pending}
        className={buttonStyles({ variant: "danger", size: "xs", className: "gap-1.5" })}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {pending ? "Removing..." : "Remove"}
      </button>
      {error ? (
        <p className="mt-1 max-w-48 text-[11px] text-[var(--ccr-danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
