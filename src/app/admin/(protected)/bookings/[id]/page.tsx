import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { BookingActions } from "@/components/admin/BookingActions";
import { BookingNotes } from "@/components/admin/BookingNotes";
import { ManualPaymentForm } from "@/components/admin/ManualPaymentForm";
import { PaymentRowActions } from "@/components/admin/PaymentRowActions";
import { RefundRequiredToast } from "@/components/admin/RefundRequiredToast";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import { computeBookingPricing, fetchNetPaidToDate } from "@/lib/payments/pricing";

type BookingDetails = {
  id: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  status: string;
  pricing_json: Record<string, unknown>;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  daily_rate_cents: number;
  deposit_cents: number;
};

type PaymentRow = {
  id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  currency: string;
  created_at: string;
  metadata_json: Record<string, unknown> | null;
  deleted_at?: string | null;
  deleted_reason?: string | null;
};

type AdminNote = {
  message: string;
  created_at?: string;
  user_id?: string;
};

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

function statusBadge(status: string) {
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    PENDING_PAYMENT: "bg-amber-100 text-amber-800",
    CONFIRMED: "bg-emerald-100 text-emerald-800",
    PICKED_UP: "bg-blue-100 text-blue-800",
    RETURNED: "bg-slate-200 text-slate-800",
    CANCELLED: "bg-red-100 text-red-700",
  };
  return styles[normalized] ?? "bg-slate-100 text-slate-700";
}

export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest();
  const canAdmin = String(session?.role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";

  const bookingResult = await dbQuery<BookingDetails>(
    "select b.id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <p className="text-sm text-[var(--ccr-muted)]">Booking not found.</p>
      </div>
    );
  }

  let payments: { rows: PaymentRow[]; rowCount: number };
  try {
    payments = await dbQuery<PaymentRow>(
      "select id, provider, status, deposit_amount_cents, currency, created_at, metadata_json, deleted_at, deleted_reason from payments where booking_id = $1 order by created_at desc",
      [id],
    );
  } catch (error) {
    // Graceful fallback if the DB hasn't been migrated yet.
    if (isUndefinedColumn(error, "deleted_at")) {
      payments = await dbQuery<PaymentRow>(
        "select id, provider, status, deposit_amount_cents, currency, created_at, metadata_json from payments where booking_id = $1 order by created_at desc",
        [id],
      );
    } else {
      throw error;
    }
  }

  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    netPaidToDate,
  });
  const days = summary.days;
  const total = summary.total;
  const paidToDate = summary.netPaidToDate;
  const balanceDue = summary.balanceDue;
  const isPaidInFull = summary.paymentStatus === "PAID_IN_FULL";
  const refundRequired = summary.refundRequired;

  const notesRaw = (pricing as { admin_notes?: AdminNote[] }).admin_notes;
  const notes = Array.isArray(notesRaw) ? [...notesRaw] : [];
  notes.sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <RefundRequiredToast refundRequired={refundRequired} />
      <Link href="/admin/bookings" className="text-sm font-semibold text-[var(--ccr-text)]">
        Back to bookings
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Booking</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-[var(--ccr-text)]">{booking.id}</h1>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadge(
                booking.status,
              )}`}
            >
              {booking.status.replace("_", " ")}
            </span>
          </div>
        </div>
        <BookingActions
          bookingId={booking.id}
          bookingStatus={booking.status}
          isPaidInFull={isPaidInFull}
          canAdmin={canAdmin}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Booking Details</h2>
          <dl className="mt-4 grid gap-3 text-sm text-[var(--ccr-muted)]">
            <div>
              <dt className="text-xs uppercase tracking-wide">Status</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{booking.status}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Dates</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">
                {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide">Pickup Location</dt>
              <dd className="font-semibold text-[var(--ccr-text)]">{booking.pickup_location}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Customer & Vehicle</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Customer</p>
              <p className="font-semibold text-[var(--ccr-text)]">{booking.customer_name}</p>
              <p className="text-[var(--ccr-muted)]">{booking.customer_email}</p>
              <p className="text-[var(--ccr-muted)]">{booking.customer_phone}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Vehicle</p>
              <p className="font-semibold text-[var(--ccr-text)]">
                {booking.vehicle_year} {booking.vehicle_make} {booking.vehicle_model}
              </p>
              <p className="text-[var(--ccr-muted)]">Daily Rate: {formatJmd(dailyRate)}</p>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Charges Summary</h2>
          {refundRequired ? (
            <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-100">
              Refund required
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 text-sm text-[var(--ccr-muted)] md:grid-cols-2">
          <div className="flex items-center justify-between">
            <span>Days</span>
            <span className="font-semibold text-[var(--ccr-text)]">{days}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Daily Rate</span>
            <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(dailyRate)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Total</span>
            <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(total)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Deposit</span>
            <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(deposit)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Paid to date</span>
            <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(paidToDate)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Balance due</span>
            <span className="font-semibold text-[var(--ccr-text)]">{formatJmd(balanceDue)}</span>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Payments</h2>
          <Link
            href={`/admin/payments?bookingId=${booking.id}`}
            className="text-sm font-semibold text-[var(--ccr-text)]"
          >
            View in Payments
          </Link>
        </div>
        <ManualPaymentForm
          bookingId={booking.id}
          total={total}
          paidToDate={paidToDate}
          balanceDue={balanceDue}
        />
        {payments.rows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">No payments recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Payment ID</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.rows.map((payment: PaymentRow) => (
                  <tr
                    key={payment.id}
                    className={`border-b border-[var(--ccr-border)] last:border-b-0 ${
                      payment.deleted_at ? "opacity-60" : ""
                    }`}
                    title={payment.deleted_reason ? `Deleted: ${payment.deleted_reason}` : undefined}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-[var(--ccr-text)]">
                      {payment.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      {payment.provider === "MANUAL"
                        ? (payment.metadata_json?.method_label as string | undefined) ??
                          (payment.metadata_json?.method as string | undefined) ??
                          "MANUAL"
                        : payment.provider}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      {formatPaymentStatus(payment.status, {
                        paymentType:
                          typeof payment.metadata_json?.payment_type === "string"
                            ? String(payment.metadata_json.payment_type)
                            : null,
                      })}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      {formatJmd(payment.deposit_amount_cents)}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-muted)]">
                      {fmtDate(payment.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <PaymentRowActions
                        paymentId={payment.id}
                        provider={payment.provider}
                        status={payment.status}
                        amount={Number(payment.deposit_amount_cents ?? 0)}
                        deletedAt={payment.deleted_at}
                        canAdmin={canAdmin}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[var(--ccr-text)]">Admin Notes</h2>
        <BookingNotes bookingId={booking.id} notes={notes} />
      </section>
    </div>
  );
}
