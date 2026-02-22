"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { refreshUnreadMessagesCount } from "@/lib/messages/useUnreadMessagesCount";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type MessageStatusActionsProps = {
  messageId: string;
  status: "NEW" | "READ" | "ARCHIVED";
  didAutoMarkRead?: boolean;
};

type ActionType = "MARK_READ" | "MARK_NEW" | "ARCHIVE" | "UNARCHIVE";

export function MessageStatusActions({
  messageId,
  status,
  didAutoMarkRead = false,
}: MessageStatusActionsProps) {
  const router = useRouter();
  const didAutoRefreshRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!didAutoMarkRead || didAutoRefreshRef.current) return;
    didAutoRefreshRef.current = true;
    void refreshUnreadMessagesCount();
  }, [didAutoMarkRead]);

  async function runAction(action: ActionType) {
    if (pendingAction) return;

    setPendingAction(action);
    setError(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/messages/${messageId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ action, csrfToken }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to update message status.");
        return;
      }

      await refreshUnreadMessagesCount();
      router.refresh();
    } catch {
      setError("Unable to update message status.");
    } finally {
      setPendingAction(null);
    }
  }

  const isPending = Boolean(pendingAction);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "NEW" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("MARK_READ")}
            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            {pendingAction === "MARK_READ" ? "Saving..." : "Mark as Read"}
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("MARK_NEW")}
            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            {pendingAction === "MARK_NEW" ? "Saving..." : "Mark as New"}
          </button>
        )}

        {status === "ARCHIVED" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("UNARCHIVE")}
            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            {pendingAction === "UNARCHIVE" ? "Saving..." : "Unarchive"}
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("ARCHIVE")}
            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
          >
            {pendingAction === "ARCHIVE" ? "Saving..." : "Archive"}
          </button>
        )}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
