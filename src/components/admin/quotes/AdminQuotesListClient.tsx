"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { QuoteCreateModal } from "@/components/admin/quotes/QuoteCreateModal";
import { QuoteEmailModal } from "@/components/admin/quotes/QuoteEmailModal";
import { PaginationSummary } from "@/components/admin/PaginationSummaryNav";
import { SortableTh } from "@/components/admin/SortableTh";
import {
  applySortToSearchParams,
  readSortFromSearchParams,
  type SortState,
} from "@/components/admin/tableSort";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { formatJmd } from "@/lib/money";
import {
  buildLoadedPaginationProgress,
  STANDARD_PAGE_SIZE_OPTIONS,
} from "@/lib/pagination/sharedPagination";
import {
  normalizeQuoteStatusFilter,
  QUOTE_STATUS_OPTIONS,
  quoteStatusLabel,
  QUOTE_STATUS_PILL_BASE_CLASS,
  quoteStatusPillToneClass,
  shortQuoteId,
} from "@/lib/quotes/quoteUi";

type QuoteListItem = {
  id: string;
  createdAt: string;
  status: string;
  expiresAt: string | null;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  pickupLocationText: string;
  dropoffLocationText: string;
  vehicleId: string | null;
  vehicleLabel: string;
  vehicleClass: string | null;
  baseTotalCents: number;
  insuranceTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  promoCode: string | null;
  insuranceEnabled: boolean;
  tags: string[];
  comments: string | null;
  commissionPartnerName: string | null;
  clientPaysAtPartner: boolean;
  rackPriceCents: number | null;
  lastEmailedAt: string | null;
};

type QuotesListResponse = {
  ok?: boolean;
  items?: QuoteListItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  error?: string;
};

const QUOTE_SORT_COLUMNS = [
  "created",
  "customer",
  "email",
  "pickup",
  "return",
  "vehicle",
  "total",
  "status",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeRows(value: string | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return STANDARD_PAGE_SIZE_OPTIONS[0];
  if (!STANDARD_PAGE_SIZE_OPTIONS.some((option) => option === parsed)) {
    return STANDARD_PAGE_SIZE_OPTIONS[0];
  }
  return parsed;
}

function truncateText(value: string | null | undefined, max = 48) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "—";
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function normalizeDateParam(value: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  return DATE_RE.test(trimmed) ? trimmed : "";
}

export function AdminQuotesListClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const statusFilter = normalizeQuoteStatusFilter(searchParams.get("status"));
  const query = searchParams.get("q")?.trim() ?? "";
  const createdFrom = normalizeDateParam(searchParams.get("createdFrom"));
  const createdTo = normalizeDateParam(searchParams.get("createdTo"));
  const rentalFrom = normalizeDateParam(searchParams.get("rentalFrom"));
  const rentalTo = normalizeDateParam(searchParams.get("rentalTo"));
  const rowsPerPage = normalizeRows(searchParams.get("rows"));
  const createdFlag = searchParams.get("created") === "1";

  const sort = readSortFromSearchParams(searchParams, {
    allowedSortBy: QUOTE_SORT_COLUMNS,
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });

  const [draftStatus, setDraftStatus] = useState(statusFilter);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftCreatedFrom, setDraftCreatedFrom] = useState(createdFrom);
  const [draftCreatedTo, setDraftCreatedTo] = useState(createdTo);
  const [draftRentalFrom, setDraftRentalFrom] = useState(rentalFrom);
  const [draftRentalTo, setDraftRentalTo] = useState(rentalTo);

  const [rows, setRows] = useState<QuoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingTables, setMissingTables] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [emailTarget, setEmailTarget] = useState<QuoteListItem | null>(null);

  useEffect(() => {
    setDraftStatus(statusFilter);
    setDraftQuery(query);
    setDraftCreatedFrom(createdFrom);
    setDraftCreatedTo(createdTo);
    setDraftRentalFrom(rentalFrom);
    setDraftRentalTo(rentalTo);
  }, [createdFrom, createdTo, query, rentalFrom, rentalTo, statusFilter]);

  const queryStateKey = useMemo(
    () =>
      JSON.stringify({
        statusFilter,
        query,
        createdFrom,
        createdTo,
        rentalFrom,
        rentalTo,
        sortBy: sort.sortBy,
        sortDir: sort.sortDir,
        rowsPerPage,
      }),
    [
      createdFrom,
      createdTo,
      query,
      rentalFrom,
      rentalTo,
      rowsPerPage,
      sort.sortBy,
      sort.sortDir,
      statusFilter,
    ],
  );

  const updateParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("cursor");
      nextParams.delete("page");
      nextParams.delete("created");

      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          nextParams.delete(key);
        } else {
          nextParams.set(key, value);
        }
      }

      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const fetchQuotes = useCallback(
    async (options?: { cursor?: string | null; append?: boolean }) => {
      const append = Boolean(options?.append);
      const cursor = options?.cursor ?? null;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (query) params.set("q", query);
      if (createdFrom) params.set("createdFrom", createdFrom);
      if (createdTo) params.set("createdTo", createdTo);
      if (rentalFrom) params.set("rentalFrom", rentalFrom);
      if (rentalTo) params.set("rentalTo", rentalTo);
      if (sort.sortBy) params.set("sortBy", sort.sortBy);
      if (sort.sortDir) params.set("sortDir", sort.sortDir);
      params.set("limit", String(rowsPerPage));
      if (cursor) params.set("cursor", cursor);

      try {
        const response = await fetch(`/api/admin/quotes?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => ({}))) as QuotesListResponse;

        if (!response.ok || !payload.ok) {
          const message = payload.error ?? "Unable to load quotes.";
          setError(message);
          setMissingTables(response.status === 503 || message.toLowerCase().includes("not installed"));
          if (!append) {
            setRows([]);
            setNextCursor(null);
            setHasMore(false);
            setTotalCount(0);
          }
          return;
        }

        const incoming = Array.isArray(payload.items) ? payload.items : [];
        setMissingTables(false);
        setError(null);

        if (append) {
          setRows((current) => {
            const byId = new Map(current.map((row) => [row.id, row]));
            for (const row of incoming) {
              byId.set(row.id, row);
            }
            return [...byId.values()];
          });
        } else {
          setRows(incoming);
        }

        setNextCursor(payload.nextCursor ?? null);
        setHasMore(Boolean(payload.hasMore));
        setTotalCount(Number(payload.totalCount ?? incoming.length));
      } catch {
        setError("Unable to load quotes.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      createdFrom,
      createdTo,
      query,
      rentalFrom,
      rentalTo,
      rowsPerPage,
      sort.sortBy,
      sort.sortDir,
      statusFilter,
    ],
  );

  useEffect(() => {
    void fetchQuotes();
  }, [fetchQuotes, queryStateKey]);

  const pagination = buildLoadedPaginationProgress(rows.length, totalCount, rowsPerPage);

  const clearFilters = () => {
    setDraftStatus("all");
    setDraftQuery("");
    setDraftCreatedFrom("");
    setDraftCreatedTo("");
    setDraftRentalFrom("");
    setDraftRentalTo("");
    router.push(pathname);
  };

  const hasActiveFilters =
    statusFilter !== "all" || Boolean(query || createdFrom || createdTo || rentalFrom || rentalTo);

  const updateSort = (next: SortState) => {
    const nextParams = applySortToSearchParams(searchParams, next);
    nextParams.delete("cursor");
    nextParams.delete("page");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Bookings</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Quotes</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Create, manage, print, and email rental quotes.
          </p>
        </div>
        <QuoteCreateModal
          onCreated={(id) => {
            router.push(`/admin/bookings/quotes/${id}?created=1`);
          }}
        />
      </div>

      {createdFlag ? (
        <p className="mt-3 text-xs font-semibold text-emerald-200">Quote created successfully.</p>
      ) : null}

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:items-center sm:overflow-x-auto sm:px-2 sm:py-1 sm:scroll-pl-2 sm:scroll-pr-2">
            {QUOTE_STATUS_OPTIONS.map((option) => {
              const active = statusFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setDraftStatus(option.value);
                    updateParams({ status: option.value === "all" ? null : option.value });
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-none transition sm:px-4 sm:text-xs ${
                    active
                      ? "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white ring-1 ring-[var(--ccr-accent)]"
                      : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="w-full rounded-full border border-[var(--ccr-border)] px-4 py-1.5 text-xs font-semibold text-[var(--ccr-text)] hover:border-[var(--ccr-primary)] sm:ml-auto sm:w-auto"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:col-span-2 xl:col-span-1">
            Search
            <input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Name, email, phone, quote ID"
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Created from
            <input
              type="date"
              value={draftCreatedFrom}
              onChange={(event) => setDraftCreatedFrom(event.target.value)}
              className="promo-date-time-input mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Created to
            <input
              type="date"
              value={draftCreatedTo}
              onChange={(event) => setDraftCreatedTo(event.target.value)}
              className="promo-date-time-input mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Rental from
            <input
              type="date"
              value={draftRentalFrom}
              onChange={(event) => setDraftRentalFrom(event.target.value)}
              className="promo-date-time-input mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Rental to
            <input
              type="date"
              value={draftRentalTo}
              onChange={(event) => setDraftRentalTo(event.target.value)}
              className="promo-date-time-input mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              updateParams({
                status: draftStatus === "all" ? null : draftStatus,
                q: draftQuery.trim() || null,
                createdFrom: draftCreatedFrom || null,
                createdTo: draftCreatedTo || null,
                rentalFrom: draftRentalFrom || null,
                rentalTo: draftRentalTo || null,
              });
            }}
            className="rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Apply filters
          </button>
        </div>
      </div>

      {missingTables ? (
        <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Quotes tables are not installed.</p>
          <p className="mt-1 text-xs text-amber-100/80">Apply migrations to enable the quotes inbox.</p>
        </div>
      ) : null}

      {error && !missingTables ? <p className="mt-4 text-xs font-semibold text-red-300">{error}</p> : null}

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        <div className="divide-y divide-[var(--ccr-border)] md:hidden">
          {loading ? (
            <div className="px-4 py-6 text-sm text-[var(--ccr-muted)]">Loading quotes...</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[var(--ccr-muted)]">No quotes found.</div>
          ) : (
            rows.map((row) => {
              const rackPrice = row.rackPriceCents ?? row.baseTotalCents;
              return (
                <article key={`mobile-${row.id}`} className="space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--ccr-text)]">{row.customerFullName}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{row.customerEmail}</p>
                    </div>
                    <span className={`${QUOTE_STATUS_PILL_BASE_CLASS} ${quoteStatusPillToneClass(row.status)}`}>
                      {quoteStatusLabel(row.status)}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs text-[var(--ccr-muted)]">
                    <div>
                      <dt>Quote</dt>
                      <dd className="font-mono text-[var(--ccr-text)]">{shortQuoteId(row.id)}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd className="font-semibold text-[var(--ccr-text)]">{formatJmd(row.totalCents)}</dd>
                    </div>
                    <div>
                      <dt>Pickup</dt>
                      <dd className="text-[var(--ccr-text)]">{row.startAt ? new Date(row.startAt).toLocaleString() : "—"}</dd>
                    </div>
                    <div>
                      <dt>Return</dt>
                      <dd className="text-[var(--ccr-text)]">{row.endAt ? new Date(row.endAt).toLocaleString() : "—"}</dd>
                    </div>
                    <div>
                      <dt>Rack Price</dt>
                      <dd className="text-[var(--ccr-text)]">{formatJmd(rackPrice)}</dd>
                    </div>
                    <div>
                      <dt>Discount</dt>
                      <dd className="text-[var(--ccr-text)]">
                        {row.promoCode ? `${row.promoCode} · -${formatJmd(row.discountTotalCents)}` : "—"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/bookings/quotes/${row.id}`}
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      View
                    </Link>
                    <Link
                      href={`/admin/bookings/quotes/${row.id}/print`}
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      Print
                    </Link>
                    <button
                      type="button"
                      onClick={() => setEmailTarget(row)}
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      Email
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-[1700px] text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Reservation Type</th>
                <SortableTh label="Customer Name" columnKey="customer" sort={sort} onChange={updateSort} defaultDirection="asc" />
                <SortableTh label="Customer Email" columnKey="email" sort={sort} onChange={updateSort} defaultDirection="asc" />
                <SortableTh label="Pickup Date" columnKey="pickup" sort={sort} onChange={updateSort} defaultDirection="asc" />
                <SortableTh label="Return Date" columnKey="return" sort={sort} onChange={updateSort} defaultDirection="asc" />
                <SortableTh label="Vehicle Class" columnKey="vehicle" sort={sort} onChange={updateSort} defaultDirection="asc" />
                <th className="px-4 py-3">Commission Partner</th>
                <th className="px-4 py-3">Client pays at Partner</th>
                <th className="px-4 py-3">Rack Price (JMD)</th>
                <SortableTh label="Total Price (JMD)" columnKey="total" sort={sort} onChange={updateSort} defaultDirection="desc" />
                <SortableTh label="Status" columnKey="status" sort={sort} onChange={updateSort} defaultDirection="asc" />
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Discounts</th>
                <th className="px-4 py-3">Comments</th>
                <SortableTh label="Created" columnKey="created" sort={sort} onChange={updateSort} defaultDirection="desc" />
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-b border-[var(--ccr-border)]">
                  <td colSpan={17} className="px-4 py-6 text-sm text-[var(--ccr-muted)]">
                    Loading quotes...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr className="border-b border-[var(--ccr-border)]">
                  <td colSpan={17} className="px-4 py-6 text-sm text-[var(--ccr-muted)]">
                    No quotes found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const rackPrice = row.rackPriceCents ?? row.baseTotalCents;
                  return (
                    <tr key={row.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                        <span className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 font-bold text-[var(--ccr-accent)]">
                          {shortQuoteId(row.id)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">Reservations</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{row.customerFullName}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{row.customerEmail}</td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <TableDateTime value={row.startAt} />
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <TableDateTime value={row.endAt} />
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{row.vehicleClass ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{row.commissionPartnerName ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{row.clientPaysAtPartner ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{formatJmd(rackPrice)}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{formatJmd(row.totalCents)}</td>
                      <td className="px-4 py-3">
                        <span className={`${QUOTE_STATUS_PILL_BASE_CLASS} ${quoteStatusPillToneClass(row.status)}`}>
                          {quoteStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{row.tags.length > 0 ? row.tags.join(", ") : "—"}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        {row.promoCode ? `${row.promoCode} · -${formatJmd(row.discountTotalCents)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]" title={row.comments ?? undefined}>
                        {truncateText(row.comments)}
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        <TableDateTime value={row.createdAt} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/admin/bookings/quotes/${row.id}`}
                            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                          >
                            View
                          </Link>
                          <Link
                            href={`/admin/bookings/quotes/${row.id}/print`}
                            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                          >
                            Print
                          </Link>
                          <button
                            type="button"
                            onClick={() => setEmailTarget(row)}
                            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                          >
                            Email
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {rows.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--ccr-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Rows per page
              <select
                value={String(rowsPerPage)}
                onChange={(event) => updateParams({ rows: event.target.value })}
                className="cursor-pointer rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
              >
                {STANDARD_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={String(size)}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <PaginationSummary
                from={pagination.from}
                to={pagination.to}
                totalCount={totalCount}
                page={pagination.page}
                totalPages={pagination.totalPages}
                className="mt-0 shrink-0 flex-nowrap justify-end gap-3 whitespace-nowrap"
              />
              <button
                type="button"
                disabled={!hasMore || !nextCursor || loadingMore}
                onClick={() => void fetchQuotes({ append: true, cursor: nextCursor })}
                className="cursor-pointer rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : hasMore ? "Load more" : "No more quotes"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <QuoteEmailModal
        open={Boolean(emailTarget)}
        target={
          emailTarget
            ? {
                id: emailTarget.id,
                customerFullName: emailTarget.customerFullName,
                customerEmail: emailTarget.customerEmail,
                startAt: emailTarget.startAt,
                endAt: emailTarget.endAt,
                pickupLocationText: emailTarget.pickupLocationText,
                dropoffLocationText: emailTarget.dropoffLocationText,
                vehicleLabel: emailTarget.vehicleLabel,
                totalCents: emailTarget.totalCents,
                depositRequiredCents: emailTarget.depositRequiredCents,
                amountDueCents: emailTarget.amountDueCents,
                expiresAt: emailTarget.expiresAt,
              }
            : null
        }
        openPath={emailTarget ? `/admin/bookings/quotes/${emailTarget.id}` : undefined}
        onClose={() => setEmailTarget(null)}
      />
    </div>
  );
}
