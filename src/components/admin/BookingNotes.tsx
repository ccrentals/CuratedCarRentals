"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdminNote = {
  message: string;
  created_at?: string;
  user_id?: string;
};

type BookingNotesProps = {
  bookingId: string;
  notes: AdminNote[];
};

function fmtClientDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function BookingNotes({ bookingId, notes }: BookingNotesProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    const trimmed = note.trim();
    if (!trimmed) {
      setError("Enter a note before saving.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_note", note: trimmed }),
    });

    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Failed to save note");
      return;
    }

    setNote("");
    setMessage("Note saved.");
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--ccr-muted)]">No notes added yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((entry, index) => (
            <li key={`${entry.created_at ?? "note"}-${index}`} className="rounded-xl bg-[var(--ccr-surface-soft)] p-3">
              <p className="text-sm text-[var(--ccr-text)]">{entry.message}</p>
              {entry.created_at ? (
                <p className="mt-2 text-xs text-[var(--ccr-muted)]">{fmtClientDate(entry.created_at)}</p>
              ) : null}
            </li>
          ))}
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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveNote}
            disabled={saving}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
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
