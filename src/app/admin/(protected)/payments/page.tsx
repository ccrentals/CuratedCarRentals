import Link from "next/link";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { PaymentsFilters } from "@/components/admin/PaymentsFilters";
import PaymentLogToggle from "@/components/admin/PaymentLogToggle";
import { SortableTh } from "@/components/admin/SortableTh";
import {
  applySortToSearchParams,
  nextSort,
  readSortFromSearchParams,
  type SortDir,
} from "@/components/admin/tableSort";
import { isAdminRole } from "@/lib/auth/roles";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import {
  formatPaymentMetadataError,
  sanitizePaymentMetadataForUi,
} from "@/lib/payments/formatHistoricalPaymentError";

function extractPaymentType(meta: Record<string, unknown> | null) {
  const type = meta?.payment_type;
  return typeof type === "string" ? type : null;
}

function displayProvider(provider: string, meta: Record<string, unknown> | null) {
  if (provider !== "MANUAL") return provider;
  const label = meta?.method_label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const method = meta?.method;
  if (typeof method === "string" && method.trim()) return method.trim();
  return "MANUAL";
}

function formatPaymentLog(meta: Record<string, unknown> | null, provider: string) {
  const sanitized = sanitizePaymentMetadataForUi(meta, provider);
  return sanitized ? JSON.stringify(sanitized, null, 2) : "";
}

type PaymentRow = {
  id: string;
  public_id: string;
  booking_id: string;
  booking_public_id: string | null;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
  metadata_json: Record<string, unknown> | null;
};

type StripeAttemptRow = Pick<
  PaymentRow,
  "id" | "public_id" | "booking_id" | "booking_public_id" | "status" | "deposit_amount_cents" | "created_at"
>;

const PAYMENT_SORT_COLUMNS = [
  "payment",
  "booking",
  "customer",
  "vehicle",
  "provider",
  "status",
  "amount",
  "created",
] as const;
type PaymentSortBy = (typeof PAYMENT_SORT_COLUMNS)[number];
type PaymentSortDir = SortDir;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  if (!isAdminRole(session?.role)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Payments</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }
  const canViewPaymentErrors =
    String(session?.role ?? "")
      .trim()
      .toUpperCase() === "DEVELOPER";

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const bookingId = typeof params.bookingId === "string" ? params.bookingId.trim() : "";
  const paymentType = typeof params.paymentType === "string" ? params.paymentType.trim() : "";
  const normalizedType = paymentType === "balance" ? "balance" : paymentType === "deposit" ? "deposit" : "";
  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);
  const currentParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") currentParams.set(key, value);
  }
  const sort = readSortFromSearchParams(currentParams, {
    allowedSortBy: PAYMENT_SORT_COLUMNS,
    defaultSortBy: "created",
    defaultSortDir: "desc",
  }) as { sortBy: PaymentSortBy; sortDir: PaymentSortDir };
  const sortBy: PaymentSortBy = sort.sortBy ?? "created";
  const sortDir: PaymentSortDir = sort.sortDir ?? "desc";
  const directionSql = sortDir === "asc" ? "asc" : "desc";

  const conditions: string[] = [];
  const values: string[] = [];
  if (q) {
    values.push(`${q}%`);
    conditions.push(
      `(c.full_name ilike $${values.length} or c.email ilike $${values.length} or c.phone ilike $${values.length} or b.id::text ilike $${values.length} or b.public_id ilike $${values.length} or p.id::text ilike $${values.length} or p.public_id ilike $${values.length})`,
    );
  }
  if (bookingId) {
    values.push(bookingId);
    conditions.push(`p.booking_id = $${values.length}`);
  }
  if (normalizedType === "balance") {
    conditions.push(`coalesce(p.metadata_json->>'payment_type','deposit') = 'balance'`);
  }
  if (normalizedType === "deposit") {
    conditions.push(`coalesce(p.metadata_json->>'payment_type','deposit') <> 'balance'`);
  }

  const orderBySql =
    sortBy === "payment"
      ? `order by p.public_id ${directionSql}, p.id::text ${directionSql}`
      : sortBy === "booking"
        ? `order by b.public_id ${directionSql}, p.public_id ${directionSql}`
        : sortBy === "customer"
          ? `order by lower(c.full_name) ${directionSql}, lower(c.email) ${directionSql}, p.public_id ${directionSql}`
          : sortBy === "vehicle"
            ? `order by lower(v.make) ${directionSql}, lower(v.model) ${directionSql}, p.public_id ${directionSql}`
            : sortBy === "provider"
              ? `order by lower(p.provider) ${directionSql}, p.public_id ${directionSql}`
              : sortBy === "status"
                ? `order by upper(p.status) ${directionSql}, p.public_id ${directionSql}`
                : sortBy === "amount"
                  ? `order by p.deposit_amount_cents ${directionSql}, p.public_id ${directionSql}`
                  : `order by p.created_at ${directionSql}, p.public_id ${directionSql}`;

  const queryText =
    "select p.id, p.public_id, p.booking_id, b.public_id as booking_public_id, p.provider, p.status, p.deposit_amount_cents, p.created_at, p.metadata_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    (conditions.length ? `where ${conditions.join(" and ")} ` : "") +
    orderBySql;

  const payments = await dbQuery<PaymentRow>(queryText, values);
  const latestStripeAttempts = await dbQuery<StripeAttemptRow>(
    `select p.id, p.public_id, p.booking_id, b.public_id as booking_public_id,
            p.status, p.deposit_amount_cents, p.created_at
       from payments p
       join bookings b on b.id = p.booking_id
      where p.provider = 'STRIPE'
      order by p.created_at desc, p.public_id desc
      limit 5`,
  );
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);
  const visiblePayments = payments.rows.slice(0, visibleCount);
  const stripeTestMode = (process.env.STRIPE_TEST_MODE ?? "").trim().toLowerCase() === "true";
  const stripeSecretConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());

  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (bookingId) exportParams.set("bookingId", bookingId);
  if (normalizedType) exportParams.set("paymentType", normalizedType);
  if (sortBy) exportParams.set("sortBy", sortBy);
  if (sortDir) exportParams.set("sortDir", sortDir);
  const exportHref = exportParams.toString()
    ? `/api/admin/payments/export?${exportParams.toString()}`
    : "/api/admin/payments/export";

  const filterParams = (value: string) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (bookingId) next.set("bookingId", bookingId);
    if (value) next.set("paymentType", value);
    if (sortBy) next.set("sortBy", sortBy);
    if (sortDir) next.set("sortDir", sortDir);
    return `/admin/payments${next.toString() ? `?${next.toString()}` : ""}`;
  };

  const sortHref = (columnKey: PaymentSortBy, defaultDirection: SortDir) => {
    const next = nextSort({ sortBy, sortDir }, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(currentParams, next);
    const qs = nextParams.toString();
    return qs ? `/admin/payments?${qs}` : "/admin/payments";
  };

  return (
    <div data-testid="payments-page" className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Payments</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ccr-muted)]">
            {bookingId ? (
              <span>
                Booking: <span className="font-semibold text-[var(--ccr-text)]">{bookingId}</span>
              </span>
            ) : null}
            {normalizedType ? (
              <span>
                Type: <span className="font-semibold text-[var(--ccr-text)]">{normalizedType}</span>
              </span>
            ) : null}
            {q ? (
              <span>
                Search: <span className="font-semibold text-[var(--ccr-text)]">{q}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={exportHref}
            data-testid="payments-export-csv"
            prefetch={false}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Export CSV
          </Link>
          {q || bookingId || normalizedType ? (
            <Link
              href="/admin/payments"
              data-testid="payments-clear-filter"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Clear filter
            </Link>
          ) : null}
          <Link
            href="/admin/bookings"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            View Bookings
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {[
          { label: "All payments", value: "" },
          { label: "Deposit", value: "deposit" },
          { label: "Balance", value: "balance" },
        ].map((filter) => {
          const active = normalizedType === filter.value || (!normalizedType && !filter.value);
          return (
            <Link
              key={filter.label}
              href={filterParams(filter.value)}
              data-testid={`payments-filter-type-${filter.value || "all"}`}
              className={`rounded-full px-4 py-1 text-xs font-semibold ${
                active
                  ? "bg-[var(--ccr-primary)] text-white"
                  : "border border-[var(--ccr-border)] text-[var(--ccr-text)]"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="stripe-diagnostics">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Stripe Diagnostics
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--ccr-text)]">Environment</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--ccr-muted)]">Active provider</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">Stripe</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--ccr-muted)]">Mode</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">
                {stripeTestMode ? "Test" : "Live"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--ccr-muted)]">Checkout configuration</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">
                {stripeSecretConfigured ? "Configured" : "Missing"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--ccr-muted)]">Webhook signing</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">
                {stripeWebhookConfigured ? "Configured" : "Missing"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Latest Stripe Attempts
          </p>
          {latestStripeAttempts.rows.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {latestStripeAttempts.rows.map((payment: StripeAttemptRow) => (
                <li key={payment.id}>
                  <Link
                    href={`/admin/bookings/${payment.booking_id}`}
                    className="block rounded-xl border border-[var(--ccr-border)] px-4 py-3 transition hover:border-[var(--ccr-accent)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-semibold text-[var(--ccr-text)]">
                        {formatPaymentStatus(payment.status)} · {formatJmd(payment.deposit_amount_cents)}
                      </span>
                      <DateTimeInline
                        value={payment.created_at}
                        className="text-xs text-[var(--ccr-muted)]"
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      Payment: {payment.public_id} · Booking: {payment.booking_public_id ?? payment.booking_id}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--ccr-muted)]">No Stripe payment attempts yet.</p>
          )}
        </section>
      </div>

      <PaymentsFilters initialQuery={q} />

      <div data-testid="payments-table" className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {payments.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No payments yet.
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--ccr-border)] md:hidden">
              {visiblePayments.map((payment: PaymentRow) => {
                const formattedError = formatPaymentMetadataError(payment.metadata_json, payment.provider);
                const statusLabel = formatPaymentStatus(payment.status, {
                  paymentType: extractPaymentType(payment.metadata_json),
                });
                const providerLabel = displayProvider(payment.provider, payment.metadata_json);
                const bookingHref = `/admin/bookings/${payment.booking_id}`;
                return (
                  <article
                    key={`mobile-${payment.id}`}
                    data-testid="payments-row"
                    data-payment-id={payment.id}
                    data-payment-public-id={payment.public_id}
                    className="space-y-3 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        href={bookingHref}
                        className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 font-mono text-[11px] font-bold text-[var(--ccr-accent)]"
                        title="Open booking"
                      >
                        {payment.public_id}
                      </Link>
                      <DateTimeInline
                        value={payment.created_at}
                        className="text-xs text-[var(--ccr-muted)]"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[var(--ccr-text)]">
                        {payment.customer_name}
                      </p>
                      <p className="text-xs text-[var(--ccr-muted)]">{payment.customer_email}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        {payment.vehicle_make} {payment.vehicle_model}
                      </p>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Booking</dt>
                        <dd>
                          <Link href={bookingHref} className="font-semibold text-[var(--ccr-text)]">
                            {payment.booking_public_id ?? payment.booking_id}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Amount</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">
                          {formatJmd(payment.deposit_amount_cents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Provider</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{providerLabel}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Status</dt>
                        <dd className="font-semibold text-[var(--ccr-text)]">{statusLabel}</dd>
                      </div>
                    </dl>
                    {canViewPaymentErrors ? (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-h-4 flex-1 space-y-1">
                          {formattedError ? (
                            <>
                              <p className="text-xs font-semibold text-red-300">{formattedError.title}</p>
                              <p className="text-xs text-[var(--ccr-muted)]">{formattedError.detail}</p>
                            </>
                          ) : (
                            <p className="text-xs text-[var(--ccr-muted)]">—</p>
                          )}
                        </div>
                        <PaymentLogToggle
                          log={formatPaymentLog(payment.metadata_json, payment.provider)}
                        />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <SortableTh label="Payment" columnKey="payment" sort={{ sortBy, sortDir }} href={sortHref("payment", "asc")} />
                    <SortableTh label="Booking" columnKey="booking" sort={{ sortBy, sortDir }} href={sortHref("booking", "asc")} />
                    <SortableTh label="Customer" columnKey="customer" sort={{ sortBy, sortDir }} href={sortHref("customer", "asc")} />
                    <SortableTh label="Vehicle" columnKey="vehicle" sort={{ sortBy, sortDir }} href={sortHref("vehicle", "asc")} />
                    <SortableTh label="Provider" columnKey="provider" sort={{ sortBy, sortDir }} href={sortHref("provider", "asc")} />
                    <SortableTh label="Status" columnKey="status" sort={{ sortBy, sortDir }} href={sortHref("status", "asc")} />
                    <SortableTh label="Amount" columnKey="amount" sort={{ sortBy, sortDir }} href={sortHref("amount", "desc")} />
                    <SortableTh label="Created" columnKey="created" sort={{ sortBy, sortDir }} href={sortHref("created", "desc")} />
                    {canViewPaymentErrors ? <th className="px-4 py-3">Error</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.map((payment: PaymentRow) => {
                    const formattedError = formatPaymentMetadataError(payment.metadata_json, payment.provider);
                    const statusLabel = formatPaymentStatus(payment.status, {
                      paymentType: extractPaymentType(payment.metadata_json),
                    });
                    const providerLabel = displayProvider(payment.provider, payment.metadata_json);
                    const bookingHref = `/admin/bookings/${payment.booking_id}`;
                    return (
                      <tr
                        key={payment.id}
                        data-testid="payments-row"
                        data-payment-id={payment.id}
                        data-payment-public-id={payment.public_id}
                        className="border-b border-[var(--ccr-border)] last:border-b-0"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                          <Link
                            href={bookingHref}
                            className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                            title="Open booking"
                          >
                            {payment.public_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={bookingHref}
                            className="text-sm font-semibold text-[var(--ccr-text)]"
                          >
                            {payment.booking_public_id ?? payment.booking_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={bookingHref} className="block">
                            <p className="font-semibold text-[var(--ccr-text)]">{payment.customer_name}</p>
                            <p className="text-xs text-[var(--ccr-muted)]">{payment.customer_email}</p>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--ccr-text)]">
                          <Link href={bookingHref} className="block">
                            {payment.vehicle_make} {payment.vehicle_model}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--ccr-text)]">
                          <Link href={bookingHref} className="block">
                            {providerLabel}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--ccr-text)]">
                          <Link href={bookingHref} className="block">
                            {statusLabel}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--ccr-text)]">
                          <Link href={bookingHref} className="block">
                            {formatJmd(payment.deposit_amount_cents)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--ccr-muted)]">
                          <Link href={bookingHref} className="block">
                            <TableDateTime value={payment.created_at} />
                          </Link>
                        </td>
                        {canViewPaymentErrors ? (
                          <td className="px-4 py-3 text-xs text-red-300">
                            {formattedError ? (
                              <div className="space-y-1">
                                <div className="font-semibold">{formattedError.title}</div>
                                <div className="text-[var(--ccr-muted)]">{formattedError.detail}</div>
                              </div>
                            ) : (
                              <div className="text-[var(--ccr-muted)]">—</div>
                            )}
                            <div className="mt-2">
                              <PaymentLogToggle
                                log={formatPaymentLog(payment.metadata_json, payment.provider)}
                              />
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <LoadMorePaginationControls
              pageSize={rowsPerPage}
              loadedCount={visiblePayments.length}
              totalCount={payments.rows.length}
              noMoreLabel="No more payments"
            />
          </>
        )}
      </div>
    </div>
  );
}
