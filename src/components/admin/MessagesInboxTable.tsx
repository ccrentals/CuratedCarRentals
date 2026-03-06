"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { refreshUnreadMessagesCount } from "@/lib/messages/useUnreadMessagesCount";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { SortableTh } from "@/components/admin/SortableTh";
import {
  applySortToSearchParams,
  readSortFromSearchParams,
  type SortState,
} from "@/components/admin/tableSort";

type MessageRow = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  message: string;
  status: string;
  source: string | null;
};

type BulkAction = "MARK_READ" | "ARCHIVE" | "MARK_NEW" | "UNARCHIVE";

type MessagesInboxTableProps = {
  rows: MessageRow[];
  currentPath: string;
  canManage: boolean;
  canRunRetention: boolean;
};

function statusBadgeClass(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "ARCHIVED") {
    return "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
  }
  if (normalized === "READ") {
    return "border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  return "border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
}

function statusLabel(status: string) {
  return String(status ?? "")
    .trim()
    .toUpperCase() || "NEW";
}

function snippet(value: string) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= 90) return compact;
  return `${compact.slice(0, 87)}...`;
}

export function MessagesInboxTable({
  rows,
  currentPath,
  canManage,
  canRunRetention,
}: MessagesInboxTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>("MARK_READ");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allSelected = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((row) => selectedIds.has(row.id));
  }, [rows, selectedIds]);

  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: ["received", "name", "email", "status"],
    defaultSortBy: "received",
    defaultSortDir: "desc",
  });

  const updateSort = (next: SortState) => {
    const nextParams = applySortToSearchParams(searchParams, next);
    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(nextUrl, { scroll: false });
  };

  function toggleSelectAll() {
    if (!canManage) return;
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(rows.map((row) => row.id)));
  }

  function toggleSelected(id: string, checked: boolean) {
    if (!canManage) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function applyBulkAction() {
    if (!canManage) return;
    if (pending) return;

    const ids = [...selectedIds];
    if (ids.length === 0) {
      setError("Select at least one message.");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/messages/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ ids, action: bulkAction, csrfToken }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; updatedCount?: number }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to update selected messages.");
        return;
      }

      setSuccess(`Updated ${payload.updatedCount ?? 0} message${payload.updatedCount === 1 ? "" : "s"}.`);
      setSelectedIds(new Set());
      await refreshUnreadMessagesCount();
      router.refresh();
    } catch {
      setError("Unable to update selected messages.");
    } finally {
      setPending(false);
    }
  }

  async function runRetentionArchive() {
    if (!canRunRetention) return;
    if (pending) return;

    setPending(true);
    setError(null);
    setSuccess(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/messages/retention", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; updatedCount?: number }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to run retention archive.");
        return;
      }

      setSuccess(
        `Retention completed. Archived ${payload.updatedCount ?? 0} message${
          payload?.updatedCount === 1 ? "" : "s"
        }.`,
      );
      await refreshUnreadMessagesCount();
      router.refresh();
    } catch {
      setError("Unable to run retention archive.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ccr-border)] px-4 py-3">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[var(--ccr-muted)]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => toggleSelectAll()}
                className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
              />
              Select all
            </label>
            <span className="text-xs text-[var(--ccr-muted)]">{selectedIds.size} selected</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkAction}
              onChange={(event) => setBulkAction(event.target.value as BulkAction)}
              disabled={pending}
              className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-1.5 text-xs font-semibold text-[var(--ccr-text)]"
            >
              <option value="MARK_READ">Mark Read</option>
              <option value="ARCHIVE">Archive</option>
              <option value="MARK_NEW">Mark New</option>
              <option value="UNARCHIVE">Unarchive</option>
            </select>
            <button
              type="button"
              onClick={() => void applyBulkAction()}
              disabled={pending || selectedIds.size === 0}
              className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
            >
              {pending ? "Applying..." : "Apply"}
            </button>
            {canRunRetention ? (
              <button
                type="button"
                onClick={() => void runRetentionArchive()}
                disabled={pending}
                className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
              >
                {pending ? "Running..." : "Run 30d Archive"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="px-4 pt-3 text-xs font-semibold text-[var(--ccr-status-danger-text)]">{error}</p> : null}
      {success ? <p className="px-4 pt-3 text-xs font-semibold text-[var(--ccr-status-success-text)]">{success}</p> : null}

      <div className="divide-y divide-[var(--ccr-border)] md:hidden">
        {rows.map((row) => {
          const checked = selectedIds.has(row.id);
          return (
            <article key={`mobile-${row.id}`} className="space-y-3 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {canManage ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleSelected(row.id, event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                    />
                  ) : null}
                  <div>
                    <p className="font-semibold text-[var(--ccr-text)]">{row.name}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">{row.email}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                    row.status,
                  )}`}
                >
                  {statusLabel(row.status)}
                </span>
              </div>
              <DateTimeInline value={row.createdAt} className="text-xs text-[var(--ccr-muted)]" />
              <p className="text-sm text-[var(--ccr-text)]">{snippet(row.message)}</p>
              <Link
                href={`/admin/messages/${row.id}?markRead=1&back=${encodeURIComponent(currentPath)}`}
                className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
              >
                View
              </Link>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              {canManage ? <th className="px-4 py-3">Select</th> : null}
              <SortableTh
                label="Received"
                columnKey="received"
                sort={sort}
                onChange={updateSort}
                defaultDirection="desc"
              />
              <SortableTh
                label="Name"
                columnKey="name"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Email"
                columnKey="email"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <SortableTh
                label="Status"
                columnKey="status"
                sort={sort}
                onChange={updateSort}
                defaultDirection="asc"
              />
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checked = selectedIds.has(row.id);
              return (
                <tr key={row.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  {canManage ? (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleSelected(row.id, event.target.checked)}
                        className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    <TableDateTime value={row.createdAt} />
                  </td>
                  <td className="px-4 py-3 font-semibold text-[var(--ccr-text)]">{row.name}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{row.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                        row.status,
                      )}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">{snippet(row.message)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/messages/${row.id}?markRead=1&back=${encodeURIComponent(currentPath)}`}
                      className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
