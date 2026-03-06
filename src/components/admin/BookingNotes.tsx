"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type AdminNote = {
  note_id?: string;
  message: string;
  created_at?: string;
  user_id?: string;
  email_target?: "none" | "customer" | "internal" | "both";
  email_send_mode?: "immediate" | "scheduled" | string | null;
  email_scheduled_for?: string | null;
  email_customer_sent_at?: string | null;
  email_internal_sent_at?: string | null;
  email_cancelled_at?: string | null;
  email_cancel_reason?: string | null;
  email_last_error?: string | null;
};

type BookingNotesProps = {
  bookingId: string;
  notes: AdminNote[];
};

function normalizeTarget(value: unknown): "none" | "customer" | "internal" | "both" {
  if (value === "customer" || value === "internal" || value === "both" || value === "none") {
    return value;
  }
  return "none";
}

function pendingScheduledTargets(note: AdminNote) {
  if (note.email_send_mode !== "scheduled") return [] as Array<"customer" | "internal">;
  if (note.email_cancelled_at) return [] as Array<"customer" | "internal">;

  const target = normalizeTarget(note.email_target);
  const pending: Array<"customer" | "internal"> = [];
  if ((target === "customer" || target === "both") && !note.email_customer_sent_at) {
    pending.push("customer");
  }
  if ((target === "internal" || target === "both") && !note.email_internal_sent_at) {
    pending.push("internal");
  }
  return pending;
}

function scheduleStatusLabel(note: AdminNote) {
  if (note.email_send_mode !== "scheduled") return null;
  if (note.email_cancelled_at) return "Email schedule cancelled";
  const pending = pendingScheduledTargets(note);
  if (pending.length > 0) return "Scheduled email pending";
  return "Scheduled email sent";
}

export function BookingNotes({ bookingId, notes }: BookingNotesProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [noteEmailTarget, setNoteEmailTarget] = useState<"none" | "customer" | "internal" | "both">(
    "none",
  );
  const [noteSendMode, setNoteSendMode] = useState<"immediate" | "scheduled">("immediate");
  const [noteScheduledFor, setNoteScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancellingNoteKey, setCancellingNoteKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    const trimmed = note.trim();
    if (!trimmed) {
      setError("Enter a note before saving.");
      return;
    }

    if (noteEmailTarget !== "none" && noteSendMode === "scheduled" && !noteScheduledFor) {
      setError("Choose a date/time for the scheduled note email.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    const scheduledForIso =
      noteEmailTarget !== "none" && noteSendMode === "scheduled" && noteScheduledFor
        ? new Date(noteScheduledFor).toISOString()
        : null;

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "add_note",
        note: trimmed,
        noteEmailTarget,
        noteSendMode: noteEmailTarget === "none" ? null : noteSendMode,
        noteScheduledFor: scheduledForIso,
      }),
    });

    setSaving(false);

    if (response.status === 401) {
      setError("Session expired. Please sign in again.");
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to save note");
      return;
    }

    setNote("");
    setNoteScheduledFor("");
    const data = await response.json().catch(() => ({}));
    setMessage(typeof data.message === "string" ? data.message : "Note saved.");
    router.refresh();
  }

  async function cancelScheduledEmail(entry: AdminNote, index: number) {
    const noteKey = entry.note_id ?? `${entry.created_at ?? "note"}-${index}`;
    setCancellingNoteKey(noteKey);
    setMessage(null);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        action: "cancel_scheduled_note_email",
        noteId: entry.note_id ?? null,
        noteCreatedAt: entry.created_at ?? null,
        noteMessage: entry.message ?? null,
      }),
    });

    setCancellingNoteKey(null);
    if (response.status === 401) {
      setError("Session expired. Please sign in again.");
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to cancel scheduled email.");
      return;
    }

    const data = await response.json().catch(() => ({}));
    setMessage(
      typeof data.message === "string"
        ? data.message
        : "Scheduled note email cancelled.",
    );
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--ccr-muted)]">No notes added yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((entry, index) => {
            const noteKey = entry.note_id ?? `${entry.created_at ?? "note"}-${index}`;
            const scheduleStatus = scheduleStatusLabel(entry);
            const canCancel = pendingScheduledTargets(entry).length > 0;
            const scheduledForValue =
              entry.email_send_mode === "scheduled" &&
              !entry.email_cancelled_at &&
              pendingScheduledTargets(entry).length > 0
                ? entry.email_scheduled_for ?? null
                : null;

            return (
              <li key={noteKey} className="rounded-xl bg-[var(--ccr-surface-soft)] p-3">
                <p className="text-sm text-[var(--ccr-text)]">{entry.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {entry.created_at ? (
                    <DateTimeInline value={entry.created_at} className="text-xs text-[var(--ccr-muted)]" />
                  ) : null}
                  {scheduleStatus ? (
                    <span className="inline-flex items-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ccr-text)]">
                      {scheduleStatus}
                    </span>
                  ) : null}
                  {scheduledForValue ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ccr-text)]">
                      <span>Scheduled for</span>
                      <DateTimeInline value={scheduledForValue} />
                    </span>
                  ) : null}
                  {entry.email_last_error ? (
                    <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      Last error: {entry.email_last_error}
                    </span>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      onClick={() => cancelScheduledEmail(entry, index)}
                      disabled={cancellingNoteKey === noteKey}
                      className="cursor-pointer rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] hover:text-[var(--ccr-accent)] disabled:opacity-60"
                    >
                      {cancellingNoteKey === noteKey ? "Cancelling..." : "Cancel scheduled email"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Add note
        </label>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          placeholder="Add an internal note for this booking..."
        />
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Email target
            </label>
            <select
              value={noteEmailTarget}
              onChange={(event) =>
                setNoteEmailTarget(
                  event.target.value as "none" | "customer" | "internal" | "both",
                )
              }
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="none">Save note only</option>
              <option value="both">Send to customer + internal</option>
              <option value="customer">Send to customer only</option>
              <option value="internal">Send to internal only</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Send mode
            </label>
            <select
              value={noteSendMode}
              onChange={(event) =>
                setNoteSendMode(event.target.value as "immediate" | "scheduled")
              }
              disabled={noteEmailTarget === "none"}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-50"
            >
              <option value="immediate">Send now</option>
              <option value="scheduled">Send at specific date/time</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Scheduled for
            </label>
            <input
              type="datetime-local"
              value={noteScheduledFor}
              onChange={(event) => setNoteScheduledFor(event.target.value)}
              disabled={noteEmailTarget === "none" || noteSendMode !== "scheduled"}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-50"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveNote}
            disabled={saving}
            className={buttonStyles({
              variant: "primary",
              size: "sm",
              className: "text-sm",
            })}
          >
            {saving ? "Saving..." : "Save Note"}
          </button>
          {message ? <p className="text-xs text-green-700">{message}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
