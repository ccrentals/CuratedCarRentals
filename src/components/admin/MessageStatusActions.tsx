"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { refreshUnreadMessagesCount } from "@/lib/messages/useUnreadMessagesCount";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { buttonStyles } from "@/components/ui/Button";

type MessageStatusActionsProps = {
  messageId: string;
  status: "NEW" | "READ" | "ARCHIVED";
  canDeletePermanent: boolean;
  backHref: string;
};

type ActionType = "MARK_READ" | "MARK_NEW" | "ARCHIVE" | "UNARCHIVE" | "DELETE_PERMANENT";

export function MessageStatusActions({
  messageId,
  status,
  canDeletePermanent,
  backHref,
}: MessageStatusActionsProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: ActionType) {
    if (pendingAction) return;

    if (
      action === "DELETE_PERMANENT" &&
      !window.confirm("Permanently delete this trashed message? This cannot be undone.")
    ) {
      return;
    }

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
      if (action === "DELETE_PERMANENT") {
        router.push(backHref);
        router.refresh();
        return;
      }
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
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            {pendingAction === "MARK_READ" ? "Saving..." : "Mark as Read"}
          </button>
        ) : null}

        {status !== "NEW" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("MARK_NEW")}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            {pendingAction === "MARK_NEW" ? "Saving..." : "Mark as New"}
          </button>
        ) : null}

        {status === "ARCHIVED" ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction("UNARCHIVE")}
              className={buttonStyles({ variant: "secondary", size: "sm" })}
            >
              {pendingAction === "UNARCHIVE" ? "Saving..." : "Restore to Read"}
            </button>
            {canDeletePermanent ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => runAction("DELETE_PERMANENT")}
                className={buttonStyles({ variant: "danger", size: "sm" })}
              >
                {pendingAction === "DELETE_PERMANENT" ? "Deleting..." : "Delete Permanently"}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("ARCHIVE")}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            {pendingAction === "ARCHIVE" ? "Saving..." : "Trash"}
          </button>
        )}
      </div>

      {status === "ARCHIVED" ? (
        <p className="text-xs text-[var(--ccr-muted)]">
          Restore returns this message to{" "}
          <span className="font-semibold text-[var(--ccr-text)]">Read</span>. Use{" "}
          <span className="font-semibold text-[var(--ccr-text)]">Mark as New</span> if you need it back in the unread
          queue.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
