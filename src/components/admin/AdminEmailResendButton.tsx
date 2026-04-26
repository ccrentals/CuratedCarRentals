"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

export function AdminEmailResendButton({
  recordId,
}: {
  recordId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/emails/${encodeURIComponent(recordId)}/resend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to resend email.");
        return;
      }

      router.refresh();
    } catch {
      setError("Unable to resend email.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleResend}
        disabled={pending}
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {pending ? "Resending..." : "Resend Email"}
      </button>
      {error ? (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
