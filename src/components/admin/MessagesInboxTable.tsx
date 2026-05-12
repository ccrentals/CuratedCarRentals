"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { TableDateTime } from "@/components/shared/TableDateTime";
import { refreshUnreadMessagesCount } from "@/lib/messages/useUnreadMessagesCount";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { SortableTh } from "@/components/admin/SortableTh";
import { fmtAdminDateTimeNoSeconds } from "@/lib/dateFormat";
import {
  applySortToSearchParams,
  readSortFromSearchParams,
  type SortState,
} from "@/components/admin/tableSort";
import type { AdminMessageListItem } from "@/lib/messages/adminMessages";

type BulkAction = "MARK_READ" | "ARCHIVE" | "MARK_NEW" | "UNARCHIVE" | "DELETE_PERMANENT";
type ViewMode = "inbox" | "trash";

type MessagesInboxTableProps = {
  rows: AdminMessageListItem[];
  currentPath: string;
  canManage: boolean;
  canDeletePermanent: boolean;
  viewMode: ViewMode;
};

function statusBadgeClass(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "ARCHIVED" || normalized === "TRASH") {
    return "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
  }
  if (normalized === "READ") {
    return "border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  return "border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
}

function snippet(value: string) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= 90) return compact;
  return `${compact.slice(0, 87)}...`;
}

function formatAdminDateTime(value: string) {
  return fmtAdminDateTimeNoSeconds(value) || "—";
}

export function MessagesInboxTable({
  rows,
  currentPath,
  canManage,
  canDeletePermanent,
  viewMode,
}: MessagesInboxTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>("MARK_READ");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingRowAction, setPendingRowAction] = useState<string | null>(null);

  const bulkOptions = useMemo<Array<{ value: BulkAction; label: string }>>(() => {
    if (viewMode === "trash") {
      const options: Array<{ value: BulkAction; label: string }> = [
        { value: "UNARCHIVE", label: "Restore to Read" },
      ];
      if (canDeletePermanent) {
        options.push({ value: "DELETE_PERMANENT", label: "Delete Permanently" });
      }
      return options;
    }

    return [
      { value: "MARK_READ", label: "Mark as Read" },
      { value: "ARCHIVE", label: "Move to Trash" },
      { value: "MARK_NEW", label: "Mark as New" },
    ];
  }, [canDeletePermanent, viewMode]);

  useEffect(() => {
    if (bulkOptions.some((option) => option.value === bulkAction)) return;
    setBulkAction(bulkOptions[0]?.value ?? "MARK_READ");
  }, [bulkAction, bulkOptions]);

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

  function bulkActionSuccessLabel(action: BulkAction, count: number) {
    const suffix = count === 1 ? "" : "s";
    if (action === "ARCHIVE") return `Moved ${count} message${suffix} to Trash.`;
    if (action === "UNARCHIVE") return `Restored ${count} message${suffix} to Read.`;
    if (action === "MARK_NEW") return `Marked ${count} message${suffix} as New.`;
    if (action === "DELETE_PERMANENT") return `Permanently deleted ${count} message${suffix}.`;
    return `Marked ${count} message${suffix} as Read.`;
  }

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

  async function runRowAction(rowId: string, action: BulkAction) {
    if (!canManage || pending || pendingRowAction) return;

    if (
      action === "DELETE_PERMANENT" &&
      !window.confirm("Permanently delete this trashed message? This cannot be undone.")
    ) {
      return;
    }

    setPendingRowAction(`${rowId}:${action}`);
    setError(null);
    setSuccess(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/messages/${rowId}`, {
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
        setError(payload?.error ?? "Unable to update message.");
        return;
      }

      if (action === "ARCHIVE") {
        setSuccess("Moved message to Trash.");
      } else if (action === "UNARCHIVE") {
        setSuccess("Restored message to Read.");
      } else if (action === "DELETE_PERMANENT") {
        setSuccess("Permanently deleted message.");
      } else if (action === "MARK_NEW") {
        setSuccess("Marked message as New.");
      } else {
        setSuccess("Marked message as Read.");
      }
      await refreshUnreadMessagesCount();
      router.refresh();
    } catch {
      setError("Unable to update message.");
    } finally {
      setPendingRowAction(null);
    }
  }

  async function applyBulkAction() {
    if (!canManage) return;
    if (pending) return;

    const ids = [...selectedIds];
    if (ids.length === 0) {
      setError("Select at least one message.");
      return;
    }

    if (
      bulkAction === "DELETE_PERMANENT" &&
      !window.confirm(
        `Permanently delete ${ids.length} trashed message${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
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
        | {
            ok?: boolean;
            error?: string;
            updatedCount?: number;
            deletedCount?: number;
            blockedIds?: string[];
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to update selected messages.");
        return;
      }

      const affectedCount =
        bulkAction === "DELETE_PERMANENT"
          ? payload.deletedCount ?? payload.updatedCount ?? 0
          : payload.updatedCount ?? 0;
      setSuccess(bulkActionSuccessLabel(bulkAction, affectedCount));
      if (bulkAction === "DELETE_PERMANENT" && (payload.blockedIds?.length ?? 0) > 0) {
        setError(
          `${payload.blockedIds?.length ?? 0} selected message${payload.blockedIds?.length === 1 ? "" : "s"} could not be deleted because they are not in Trash.`,
        );
      }
      setSelectedIds(new Set());
      await refreshUnreadMessagesCount();
      router.refresh();
    } catch {
      setError("Unable to update selected messages.");
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
              Select this page
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
              {bulkOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void applyBulkAction()}
              disabled={pending || selectedIds.size === 0}
              className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
            >
              {pending ? "Applying..." : "Apply"}
            </button>
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
                    <p className="font-semibold text-[var(--ccr-text)]">{row.displayName}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">{row.displayEmail}</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      {row.sourceLabel}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                    row.visibleStatus,
                  )}`}
                >
                  {row.statusLabel}
                </span>
              </div>
              <p className="text-xs text-[var(--ccr-muted)]">{formatAdminDateTime(row.createdAt)}</p>
              {row.relatedEntityLabel ? (
                row.relatedEntityHref ? (
                  <Link
                    href={row.relatedEntityHref}
                    className="inline-flex text-xs font-semibold text-[var(--ccr-accent)] underline-offset-2 hover:underline"
                  >
                    {row.relatedEntityLabel}
                  </Link>
                ) : (
                  <p className="text-xs text-[var(--ccr-muted)]">{row.relatedEntityLabel}</p>
                )
              ) : null}
              <p className="text-sm text-[var(--ccr-text)]">{snippet(row.snippet)}</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/admin/messages/${row.id}?back=${encodeURIComponent(currentPath)}`}
                  className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  View
                </Link>
                {canManage && !row.isTrashed ? (
                  <button
                    type="button"
                    onClick={() => void runRowAction(row.id, "ARCHIVE")}
                    disabled={Boolean(pendingRowAction) || pending}
                    className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
                  >
                    {pendingRowAction === `${row.id}:ARCHIVE` ? "Moving..." : "Trash"}
                  </button>
                ) : null}
                {canManage && row.isTrashed ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void runRowAction(row.id, "UNARCHIVE")}
                      disabled={Boolean(pendingRowAction) || pending}
                      className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
                    >
                      {pendingRowAction === `${row.id}:UNARCHIVE` ? "Restoring..." : "Restore"}
                    </button>
                    {canDeletePermanent ? (
                      <button
                        type="button"
                        onClick={() => void runRowAction(row.id, "DELETE_PERMANENT")}
                        disabled={Boolean(pendingRowAction) || pending}
                        className="inline-flex rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-50"
                      >
                        {pendingRowAction === `${row.id}:DELETE_PERMANENT` ? "Deleting..." : "Delete"}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
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
              <th className="px-4 py-3">Type</th>
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
                    <TableDateTime value={formatAdminDateTime(row.createdAt)} />
                  </td>
                  <td className="px-4 py-3 font-semibold text-[var(--ccr-text)]">{row.displayName}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{row.displayEmail}</td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">{row.sourceLabel}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                        row.visibleStatus,
                      )}`}
                    >
                      {row.statusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    <p>{snippet(row.snippet)}</p>
                    {row.relatedEntityLabel ? (
                      row.relatedEntityHref ? (
                        <Link
                          href={row.relatedEntityHref}
                          className="mt-1 inline-flex text-xs font-semibold text-[var(--ccr-accent)] underline-offset-2 hover:underline"
                        >
                          {row.relatedEntityLabel}
                        </Link>
                      ) : (
                        <p className="mt-1 text-xs">{row.relatedEntityLabel}</p>
                      )
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/messages/${row.id}?back=${encodeURIComponent(currentPath)}`}
                        className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        View
                      </Link>
                      {canManage && !row.isTrashed ? (
                        <button
                          type="button"
                          onClick={() => void runRowAction(row.id, "ARCHIVE")}
                          disabled={Boolean(pendingRowAction) || pending}
                          className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
                        >
                          {pendingRowAction === `${row.id}:ARCHIVE` ? "Moving..." : "Trash"}
                        </button>
                      ) : null}
                      {canManage && row.isTrashed ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void runRowAction(row.id, "UNARCHIVE")}
                            disabled={Boolean(pendingRowAction) || pending}
                            className="inline-flex rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-50"
                          >
                            {pendingRowAction === `${row.id}:UNARCHIVE` ? "Restoring..." : "Restore"}
                          </button>
                          {canDeletePermanent ? (
                            <button
                              type="button"
                              onClick={() => void runRowAction(row.id, "DELETE_PERMANENT")}
                              disabled={Boolean(pendingRowAction) || pending}
                              className="inline-flex rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-50"
                            >
                              {pendingRowAction === `${row.id}:DELETE_PERMANENT` ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
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
