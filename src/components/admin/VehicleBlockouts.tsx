"use client";

import { useEffect, useMemo, useState } from "react";

import { BlockoutModal } from "@/components/admin/BlockoutModal";
import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import type { SortState } from "@/components/admin/tableSort";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

type VehicleOption = {
  id: string;
  make: string;
  model: string;
};

type BlockoutRow = {
  id: string;
  vehicle_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes?: string | null;
};

type VehicleBlockoutsProps = {
  vehicle: VehicleOption;
};

const BLOCKOUTS_PAGE_SIZE = 5;

function compareBlockoutText(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "", undefined, { sensitivity: "base" });
}

export function VehicleBlockouts({ vehicle }: VehicleBlockoutsProps) {
  const [blockouts, setBlockouts] = useState<BlockoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeBlockout, setActiveBlockout] = useState<BlockoutRow | null>(null);
  const [sort, setSort] = useState<SortState>({ sortBy: "start", sortDir: "asc" });
  const [page, setPage] = useState(1);

  async function loadBlockouts() {
    setLoading(true);
    setError(null);
    setTableMissing(false);

    const url = `/api/admin/blockouts?vehicleId=${encodeURIComponent(vehicle.id)}`;

    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));

    setLoading(false);

    if (!response.ok) {
      if (data.error === "BLOCKOUTS_TABLE_MISSING") {
        setTableMissing(true);
        setBlockouts([]);
        return;
      }
      setError(data.error ?? "Failed to load blockouts.");
      return;
    }

    setBlockouts(Array.isArray(data.blockouts) ? data.blockouts : []);
    setPage(1);
  }

  async function handleDelete(blockout: BlockoutRow) {
    const confirmed = window.confirm("Delete this blockout?");
    if (!confirmed) return;
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/blockouts/${blockout.id}`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrfToken ?? "",
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.error === "BLOCKOUTS_TABLE_MISSING") {
        setTableMissing(true);
        setError("Blockouts table is not installed.");
        return;
      }
      setError(data.error ?? "Failed to delete blockout.");
      return;
    }
    loadBlockouts();
  }

  useEffect(() => {
    setPage(1);
    loadBlockouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id]);

  const modalInitial = useMemo(() => {
    if (activeBlockout) {
      return {
        id: activeBlockout.id,
        vehicleId: vehicle.id,
        startAt: activeBlockout.start_at,
        endAt: activeBlockout.end_at,
        reason: activeBlockout.reason,
        notes: activeBlockout.notes ?? "",
      };
    }

    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 1);
    return {
      vehicleId: vehicle.id,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      reason: "",
      notes: "",
    };
  }, [activeBlockout, vehicle.id]);

  const sortedBlockouts = useMemo(() => {
    const direction = sort.sortDir === "desc" ? -1 : 1;
    const sorted = [...blockouts].sort((left, right) => {
      switch (sort.sortBy) {
        case "end":
          return (new Date(left.end_at).getTime() - new Date(right.end_at).getTime()) * direction;
        case "reason":
          return compareBlockoutText(left.reason, right.reason) * direction;
        case "notes":
          return compareBlockoutText(left.notes, right.notes) * direction;
        case "start":
        default:
          return (new Date(left.start_at).getTime() - new Date(right.start_at).getTime()) * direction;
      }
    });

    return sorted;
  }, [blockouts, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedBlockouts.length / BLOCKOUTS_PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const currentPageBlockouts = useMemo(() => {
    const startIndex = (page - 1) * BLOCKOUTS_PAGE_SIZE;
    return sortedBlockouts.slice(startIndex, startIndex + BLOCKOUTS_PAGE_SIZE);
  }, [page, sortedBlockouts]);

  const from = sortedBlockouts.length === 0 ? 0 : (page - 1) * BLOCKOUTS_PAGE_SIZE + 1;
  const to = sortedBlockouts.length === 0 ? 0 : from + currentPageBlockouts.length - 1;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <section
      data-testid="vehicle-blockouts-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Blockouts</h2>
          <p className="text-xs text-[var(--ccr-muted)]">
            {vehicle.make} {vehicle.model}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setActiveBlockout(null);
            setModalOpen(true);
          }}
          disabled={tableMissing}
          className={buttonStyles({ variant: "primary", size: "sm" })}
        >
          + Add Blockout
        </button>
      </div>

      {tableMissing ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Blockouts not configured</p>
          <p className="mt-1">
            Apply the blockouts table section from schema.sql to enable maintenance scheduling.
          </p>
        </div>
      ) : null}

      {loading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Loading...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {!loading && !error && blockouts.length === 0 && !tableMissing ? (
        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5">
          <p className="text-sm font-semibold text-[var(--ccr-text)]">No blockouts in this window.</p>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            Add a blockout to reserve this vehicle for maintenance or private use.
          </p>
        </div>
      ) : null}

      {!loading && blockouts.length > 0 ? (
        <>
          <div className="mt-4 divide-y divide-[var(--ccr-border)] md:hidden">
            {currentPageBlockouts.map((blockout) => (
              <article
                key={`mobile-${blockout.id}`}
                data-testid="vehicle-blockout-row"
                data-blockout-id={blockout.id}
                data-blockout-reason={blockout.reason}
                className="space-y-3 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ccr-text)]">{blockout.reason}</p>
                    <p className="text-xs text-[var(--ccr-muted)] break-words">
                      {blockout.notes?.trim() ? blockout.notes : "No notes"}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-1 gap-2 text-xs text-[var(--ccr-muted)]">
                  <div>
                    <dt>Start</dt>
                    <dd className="text-sm text-[var(--ccr-text)]">
                      <DateTimeInline value={blockout.start_at} />
                    </dd>
                  </div>
                  <div>
                    <dt>End</dt>
                    <dd className="text-sm text-[var(--ccr-text)]">
                      <DateTimeInline value={blockout.end_at} />
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBlockout(blockout);
                      setModalOpen(true);
                    }}
                    className={buttonStyles({ variant: "secondary", size: "sm" })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(blockout)}
                    className={buttonStyles({ variant: "danger", size: "sm" })}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <SortableTh
                    label="Start"
                    columnKey="start"
                    sort={sort}
                    onChange={(next) => {
                      setSort(next);
                      setPage(1);
                    }}
                    className="px-3 py-2"
                    defaultDirection="asc"
                  />
                  <SortableTh
                    label="End"
                    columnKey="end"
                    sort={sort}
                    onChange={(next) => {
                      setSort(next);
                      setPage(1);
                    }}
                    className="px-3 py-2"
                    defaultDirection="asc"
                  />
                  <SortableTh
                    label="Reason"
                    columnKey="reason"
                    sort={sort}
                    onChange={(next) => {
                      setSort(next);
                      setPage(1);
                    }}
                    className="px-3 py-2"
                    defaultDirection="asc"
                  />
                  <SortableTh
                    label="Notes"
                    columnKey="notes"
                    sort={sort}
                    onChange={(next) => {
                      setSort(next);
                      setPage(1);
                    }}
                    className="px-3 py-2"
                    defaultDirection="asc"
                  />
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentPageBlockouts.map((blockout) => (
                  <tr
                    key={blockout.id}
                    data-testid="vehicle-blockout-row"
                    data-blockout-id={blockout.id}
                    data-blockout-reason={blockout.reason}
                    className="border-b border-[var(--ccr-border)] last:border-b-0"
                  >
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      <TableDateTime value={blockout.start_at} />
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      <TableDateTime value={blockout.end_at} />
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{blockout.reason}</td>
                    <td className="px-3 py-2 text-[var(--ccr-muted)]">
                      {blockout.notes ? blockout.notes.slice(0, 40) : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveBlockout(blockout);
                            setModalOpen(true);
                          }}
                          className={buttonStyles({ variant: "secondary", size: "xs" })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(blockout)}
                          className={buttonStyles({ variant: "danger", size: "xs" })}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border-t border-[var(--ccr-border)] pt-3">
            <PaginationSummary
              from={from}
              to={to}
              totalCount={sortedBlockouts.length}
              page={page}
              totalPages={totalPages}
              rightContent={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={!hasPrev}
                    className={`rounded-lg border px-2 py-1 font-semibold ${
                      hasPrev
                        ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                        : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                    }`}
                  >
                    Prev
                  </button>
                  <span className="font-semibold text-[var(--ccr-text)]">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={!hasNext}
                    className={`rounded-lg border px-2 py-1 font-semibold ${
                      hasNext
                        ? "border-[var(--ccr-border)] text-[var(--ccr-text)]"
                        : "cursor-not-allowed border-[var(--ccr-border)]/40 text-[var(--ccr-muted)]/60"
                    }`}
                  >
                    Next
                  </button>
                </div>
              }
            />
          </div>
        </>
      ) : null}

      <BlockoutModal
        key={`${modalInitial.id ?? "new"}:${modalInitial.vehicleId}:${modalInitial.startAt}:${modalInitial.endAt}`}
        open={modalOpen}
        vehicles={[vehicle]}
        initial={modalInitial}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          loadBlockouts();
        }}
        onDeleted={() => {
          setModalOpen(false);
          loadBlockouts();
        }}
      />
    </section>
  );
}
