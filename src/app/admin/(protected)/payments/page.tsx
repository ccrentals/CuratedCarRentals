import Link from "next/link";

import PaymentLogToggle from "@/components/admin/PaymentLogToggle";
import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";

function maskValue(value: string | undefined, visible = 4) {
  if (!value) return "missing";
  if (value.length <= visible) return value;
  return `${"*".repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

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

function extractError(meta: Record<string, unknown> | null) {
  if (!meta) return "";
  const error = meta.error as { message?: string } | undefined;
  if (error?.message) return error.message;
  const response = meta.response as { message?: string; reasonDescription?: string } | undefined;
  if (response?.message) return response.message;
  if (response?.reasonDescription) return response.reasonDescription;
  const raw = meta.raw as { message?: string; reasonDescription?: string } | undefined;
  if (raw?.message) return raw.message;
  if (raw?.reasonDescription) return raw.reasonDescription;
  return "";
}

type PaymentRow = {
  id: string;
  booking_id: string;
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

type WipayRow = {
  id: string;
  booking_id: string;
  status: string;
  deposit_amount_cents: number;
  provider_ref: string | null;
  provider_transaction_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
};

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bookingId = typeof params.bookingId === "string" ? params.bookingId.trim() : "";
  const paymentType = typeof params.paymentType === "string" ? params.paymentType.trim() : "";
  const normalizedType = paymentType === "balance" ? "balance" : paymentType === "deposit" ? "deposit" : "";

  const conditions: string[] = [];
  const values: string[] = [];
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

  const queryText =
    "select p.id, p.booking_id, p.provider, p.status, p.deposit_amount_cents, p.created_at, p.metadata_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    (conditions.length ? `where ${conditions.join(" and ")} ` : "") +
    "order by p.created_at desc";

  const payments = await dbQuery<PaymentRow>(queryText, values);
  const wipayRecent = await dbQuery<WipayRow>(
    "select id, booking_id, status, deposit_amount_cents, provider_ref, provider_transaction_id, metadata_json, created_at from payments where provider = 'WIPAY' order by created_at desc limit 5",
  );

  const accountNumber = process.env.WIPAY_ACCOUNT_NUMBER?.trim() ?? "";
  const envSummary = {
    env: process.env.WIPAY_ENV ?? "missing",
    fee: process.env.WIPAY_FEE_STRUCTURE ?? "missing",
    origin: process.env.WIPAY_ORIGIN ?? "missing",
    siteUrl: process.env.SITE_URL ?? "missing",
    accountNumber: maskValue(accountNumber),
    accountNumberValid: accountNumber ? /^\d+$/.test(accountNumber) : false,
    apiKey: process.env.WIPAY_API_KEY ? "set" : "missing",
  };

  const exportParams = new URLSearchParams();
  if (bookingId) exportParams.set("bookingId", bookingId);
  if (normalizedType) exportParams.set("paymentType", normalizedType);
  const exportHref = exportParams.toString()
    ? `/api/admin/payments/export?${exportParams.toString()}`
    : "/api/admin/payments/export";

  const filterParams = (value: string) => {
    const next = new URLSearchParams();
    if (bookingId) next.set("bookingId", bookingId);
    if (value) next.set("paymentType", value);
    return `/admin/payments${next.toString() ? `?${next.toString()}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
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
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={exportHref}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Export CSV
          </a>
          {bookingId || normalizedType ? (
            <Link
              href="/admin/payments"
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

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            WiPay Diagnostics
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--ccr-text)]">Environment</h2>
          <dl className="mt-3 space-y-2 text-sm text-[var(--ccr-text)]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--ccr-muted)]">Environment</dt>
              <dd className="font-semibold">{envSummary.env}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--ccr-muted)]">Fee structure</dt>
              <dd className="font-semibold">{envSummary.fee}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--ccr-muted)]">Origin</dt>
              <dd className="font-semibold">{envSummary.origin}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--ccr-muted)]">Site URL</dt>
              <dd className="truncate font-semibold">{envSummary.siteUrl}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--ccr-muted)]">Account #</dt>
              <dd className="font-semibold">
                {envSummary.accountNumber}
                <span className="ml-2 text-xs text-[var(--ccr-muted)]">
                  {envSummary.accountNumberValid ? "valid" : "invalid"}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--ccr-muted)]">API key</dt>
              <dd className="font-semibold">{envSummary.apiKey}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-[var(--ccr-muted)]">
            <a
              href="/api/admin/payments/diagnostics"
              className="font-semibold text-[var(--ccr-text)] underline-offset-4 hover:underline"
            >
              View raw diagnostics JSON
            </a>
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Latest WiPay Attempts
          </p>
          {wipayRecent.rows.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ccr-muted)]">No WiPay attempts yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {wipayRecent.rows.map((row: WipayRow) => {
                const errorMessage = extractError(row.metadata_json);
                const statusLabel = formatPaymentStatus(row.status, {
                  paymentType: extractPaymentType(row.metadata_json),
                });
                return (
                  <li key={row.id}>
                    <Link
                      href={`/admin/bookings/${row.booking_id}`}
                      className="block rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-surface-soft)]"
                      title="Open booking"
                    >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-[var(--ccr-text)]">
                        {statusLabel} · {formatJmd(row.deposit_amount_cents)}
                      </div>
                      <div className="text-xs text-[var(--ccr-muted)]">{fmtDate(row.created_at)}</div>
                    </div>
                    <div className="mt-2 text-xs text-[var(--ccr-muted)]">
                      Booking:{" "}
                      <span className="font-mono font-semibold text-[var(--ccr-text)]">
                        {row.booking_id.slice(0, 8)}
                      </span>{" "}
                      · Order: {row.provider_ref ?? "-"}
                    </div>
                    {row.provider_transaction_id ? (
                      <div className="mt-1 text-xs text-[var(--ccr-muted)]">
                        Txn: {row.provider_transaction_id}
                      </div>
                    ) : null}
                    {errorMessage ? (
                      <div className="mt-2 text-xs text-red-300">{errorMessage}</div>
                    ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {payments.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No payments yet.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {payments.rows.map((payment: PaymentRow) => {
                const errorMessage = extractError(payment.metadata_json);
                const statusLabel = formatPaymentStatus(payment.status, {
                  paymentType: extractPaymentType(payment.metadata_json),
                });
                const providerLabel = displayProvider(payment.provider, payment.metadata_json);
                const bookingHref = `/admin/bookings/${payment.booking_id}`;
                return (
                  <tr key={payment.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                      <Link
                        href={bookingHref}
                        className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                        title="Open booking"
                      >
                        {payment.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={bookingHref}
                        className="text-sm font-semibold text-[var(--ccr-text)]"
                      >
                        {payment.booking_id.slice(0, 8)}
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
                        {fmtDate(payment.created_at)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-red-300">
                      <div>{errorMessage || "—"}</div>
                      <div className="mt-2">
                        <PaymentLogToggle
                          log={payment.metadata_json ? JSON.stringify(payment.metadata_json, null, 2) : ""}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
