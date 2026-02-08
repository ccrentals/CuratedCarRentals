import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { getSessionFromRequest } from "@/lib/auth/session";
import { PaymentRowActions } from "@/components/admin/PaymentRowActions";
import { UnarchiveBookingButton } from "@/components/admin/UnarchiveBookingButton";

type ArchivedBookingRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  archived_at: string | Date;
  archived_reason: string | null;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

type DeletedPaymentRow = {
  id: string;
  booking_id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  currency: string;
  created_at: string | Date;
  deleted_at: string | Date;
  deleted_reason: string | null;
  deleted_by_email: string | null;
};

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code !== "42703") return false;
  const haystack = message.toLowerCase();
  const needle = column.toLowerCase();
  return haystack.includes("does not exist") && (haystack.includes(`"${needle}"`) || haystack.includes(`.${needle}`) || haystack.includes(needle));
}

export default async function AdminBookingsArchivePage() {
  const session = await getSessionFromRequest();
  const canAdmin = isAdminRole(session?.role);

  let archiveNotConfigured = false;
  let deletedPaymentsNotConfigured = false;

  type RowsResult<T> = { rows: T[] };

  const archivedBookings: RowsResult<ArchivedBookingRow> = await (async () => {
    try {
      return await dbQuery<ArchivedBookingRow>(
        "select b.id, b.start_date, b.end_date, b.status, b.archived_at, b.archived_reason, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.archived_at is not null order by b.archived_at desc nulls last, b.created_at desc",
      );
    } catch (error) {
      if (isUndefinedColumn(error, "archived_at")) {
        archiveNotConfigured = true;
        return { rows: [] };
      }
      throw error;
    }
  })();

  const deletedPayments: RowsResult<DeletedPaymentRow> = await (async () => {
    try {
      return await dbQuery<DeletedPaymentRow>(
        "select p.id, p.booking_id, p.provider, p.status, p.deposit_amount_cents, p.currency, p.created_at, p.deleted_at, p.deleted_reason, u.email as deleted_by_email from payments p join bookings b on b.id = p.booking_id left join users u on u.id = p.deleted_by_user_id where p.deleted_at is not null and p.provider = 'MANUAL' order by p.deleted_at desc nulls last, p.created_at desc",
      );
    } catch (error) {
      if (isUndefinedColumn(error, "deleted_at")) {
        deletedPaymentsNotConfigured = true;
        return { rows: [] };
      }
      throw error;
    }
  })();

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Bookings Archive</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ccr-muted)]">
            Archived bookings are hidden from the main bookings list by default. Deleted manual payments
            are listed here for review and restore.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/bookings"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to bookings
          </Link>
        </div>
      </div>

      {archiveNotConfigured ? (
        <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Archive not configured</p>
          <p className="mt-1 text-xs text-amber-100/80">
            The bookings archive columns are missing in the connected database. Apply the archive section
            from schema.sql to enable booking archiving.
          </p>
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Archived bookings</h2>
          <span className="text-xs text-[var(--ccr-muted)]">{archivedBookings.rows.length} total</span>
        </div>

        {archivedBookings.rows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-4 py-6 text-center text-sm text-[var(--ccr-muted)]">
            No archived bookings yet.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--ccr-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Archived</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {archivedBookings.rows.map((booking) => (
                  <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="font-mono text-xs font-semibold text-[var(--ccr-text)] hover:underline"
                      >
                        {booking.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--ccr-text)]">{booking.customer_name}</p>
                      <p className="text-xs text-[var(--ccr-muted)]">{booking.customer_email}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      {booking.vehicle_make} {booking.vehicle_model}
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">
                      {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">{booking.status}</td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{fmtDate(booking.archived_at)}</td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{booking.archived_reason ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {canAdmin ? <UnarchiveBookingButton bookingId={booking.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Deleted payments</h2>
          <span className="text-xs text-[var(--ccr-muted)]">{deletedPayments.rows.length} total</span>
        </div>

        {deletedPaymentsNotConfigured ? (
          <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-semibold">Soft delete not configured</p>
            <p className="mt-1 text-xs text-amber-100/80">
              The payments deleted_* columns are missing in the connected database. Apply the payments
              soft delete section from schema.sql to enable restore.
            </p>
          </div>
        ) : null}

        {deletedPayments.rows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-4 py-6 text-center text-sm text-[var(--ccr-muted)]">
            No deleted payments.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--ccr-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Deleted</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Deleted by</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deletedPayments.rows.map((payment) => (
                  <tr key={payment.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                      {payment.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/bookings/${payment.booking_id}`}
                        className="font-mono text-xs font-semibold text-[var(--ccr-text)] hover:underline"
                      >
                        {payment.booking_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">{payment.provider}</td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">{payment.status}</td>
                    <td className="px-4 py-3 text-[var(--ccr-text)]">
                      {payment.currency} {Number(payment.deposit_amount_cents).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{fmtDate(payment.created_at)}</td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{fmtDate(payment.deleted_at)}</td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{payment.deleted_reason ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--ccr-muted)]">{payment.deleted_by_email ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <PaymentRowActions
                        paymentId={payment.id}
                        provider={payment.provider}
                        status={payment.status}
                        amount={Number(payment.deposit_amount_cents)}
                        deletedAt={String(payment.deleted_at)}
                        canAdmin={canAdmin}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
