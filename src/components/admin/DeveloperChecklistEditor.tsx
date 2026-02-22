"use client";

import { useMemo, useState } from "react";

import { DateTimeStack } from "@/components/shared/DateTimeStack";
import {
  DEVELOPER_CHECKLIST_DEFINITIONS,
  type ChecklistEntry,
  type ChecklistPriority,
  type ChecklistStatus,
} from "@/lib/developerChecklist";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type DeveloperChecklistEditorProps = {
  initialEntries: ChecklistEntry[];
  initialGeneralNotes: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
  disabled?: boolean;
};

const STATUS_OPTIONS: Array<{ value: ChecklistStatus; label: string }> = [
  { value: "NOT_TESTED", label: "Not tested" },
  { value: "PASS", label: "Pass" },
  { value: "FAIL", label: "Fail" },
];

function priorityBadgeClass(priority: ChecklistPriority) {
  switch (priority) {
    case "P0":
      return "border-red-500/40 bg-red-500/15 text-red-200";
    case "P1":
      return "border-amber-500/40 bg-amber-500/15 text-amber-100";
    case "P2":
      return "border-sky-500/40 bg-sky-500/15 text-sky-100";
    default:
      return "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
  }
}

export function DeveloperChecklistEditor({
  initialEntries,
  initialGeneralNotes,
  updatedAt,
  updatedByEmail,
  disabled,
}: DeveloperChecklistEditorProps) {
  const [entriesById, setEntriesById] = useState<Record<string, ChecklistEntry>>(() =>
    Object.fromEntries(initialEntries.map((entry) => [entry.id, entry])),
  );
  const [generalNotes, setGeneralNotes] = useState(initialGeneralNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(updatedAt);
  const [lastUpdatedBy, setLastUpdatedBy] = useState<string | null>(updatedByEmail);

  const orderedEntries = useMemo(
    () =>
      DEVELOPER_CHECKLIST_DEFINITIONS.map((definition) => {
        const existing = entriesById[definition.id];
        return {
          definition,
          entry: existing ?? {
            id: definition.id,
            status: "NOT_TESTED" as ChecklistStatus,
            notes: "",
            updatedAt: null,
          },
        };
      }),
    [entriesById],
  );

  async function saveChecklist() {
    if (disabled || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      items: orderedEntries.map(({ entry }) => entry),
      generalNotes,
    };

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/developer-checklist", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        doc?: {
          items?: ChecklistEntry[];
          generalNotes?: string;
          updatedAt?: string | null;
          updatedByEmail?: string | null;
        };
      };

      if (!response.ok || !data.ok || !data.doc?.items) {
        setError(data.error ?? "Failed to save developer checklist.");
        setSaving(false);
        return;
      }

      setEntriesById(Object.fromEntries(data.doc.items.map((entry) => [entry.id, entry])));
      setGeneralNotes(typeof data.doc.generalNotes === "string" ? data.doc.generalNotes : "");
      setLastUpdatedAt(data.doc.updatedAt ?? null);
      setLastUpdatedBy(data.doc.updatedByEmail ?? null);
      setSuccess("Developer checklist saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save developer checklist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--ccr-text)]">Go-live verification</h2>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Mark each checkpoint as pass/fail and store implementation notes for release readiness.
          </p>
        </div>
        <div className="text-xs text-[var(--ccr-muted)]">
          <div>
            Updated:{" "}
            {lastUpdatedAt ? (
              <DateTimeStack
                value={lastUpdatedAt}
                className="inline-flex font-semibold text-[var(--ccr-text)]"
              />
            ) : (
              <span className="font-semibold text-[var(--ccr-text)]">Not updated</span>
            )}
          </div>
          <div>
            By: <span className="font-semibold text-[var(--ccr-text)]">{lastUpdatedBy ?? "System"}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--ccr-border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Checkpoint</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {orderedEntries.map(({ definition, entry }) => (
              <tr key={definition.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                <td className="px-3 py-3 align-top">
                  <span
                    className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${priorityBadgeClass(
                      definition.priority,
                    )}`}
                  >
                    {definition.priority}
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <p className="font-semibold text-[var(--ccr-text)]">{definition.title}</p>
                  <p className="mt-1 text-xs text-[var(--ccr-muted)]">{definition.description}</p>
                </td>
                <td className="px-3 py-3 align-top">
                  <select
                    value={entry.status}
                    disabled={disabled || saving}
                    onChange={(event) =>
                      setEntriesById((current) => ({
                        ...current,
                        [definition.id]: {
                          ...entry,
                          status: event.target.value as ChecklistStatus,
                        },
                      }))
                    }
                    className="w-36 rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3 align-top">
                  <textarea
                    value={entry.notes}
                    disabled={disabled || saving}
                    onChange={(event) =>
                      setEntriesById((current) => ({
                        ...current,
                        [definition.id]: {
                          ...entry,
                          notes: event.target.value,
                        },
                      }))
                    }
                    rows={2}
                    placeholder="Add implementation or test notes..."
                    className="w-full min-w-[16rem] rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-xs text-[var(--ccr-text)] placeholder:text-[var(--ccr-muted)]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Release notes
        </label>
        <textarea
          value={generalNotes}
          disabled={disabled || saving}
          onChange={(event) => setGeneralNotes(event.target.value)}
          rows={5}
          placeholder="Capture deployment notes, open issues, rollback info, and release owner comments..."
          className="mt-2 w-full rounded-2xl border border-[var(--ccr-border)] bg-transparent px-4 py-3 text-sm text-[var(--ccr-text)] placeholder:text-[var(--ccr-muted)]"
        />
      </div>

      {error ? <p className="mt-4 text-sm font-semibold text-red-300">{error}</p> : null}
      {success ? <p className="mt-4 text-sm font-semibold text-[var(--ccr-text)]">{success}</p> : null}

      <div className="mt-5">
        <button
          type="button"
          onClick={saveChecklist}
          disabled={disabled || saving}
          className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save checklist"}
        </button>
      </div>
    </section>
  );
}
