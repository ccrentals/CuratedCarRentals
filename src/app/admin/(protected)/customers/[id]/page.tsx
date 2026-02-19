import Link from "next/link";

import { CustomerSnapshotBookingsTable } from "@/components/admin/CustomerSnapshotBookingsTable";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchCustomerSnapshotBookingsPage } from "@/lib/customers/customerSnapshotBookings";
import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { CustomerProfileForm } from "@/components/admin/CustomerProfileForm";
import { formatLegalIdTypeLabel } from "@/lib/customers/legalId";
import { CustomerBlockToggleButton } from "@/components/admin/CustomerBlockToggleButton";

type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  blocked_reason: string | null;
  legal_id_type: string | null;
  legal_id_number: string | null;
  legal_id_image_url: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  last_booked_at: string | null;
  total_bookings: number;
  total_spend: number;
};

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const normalizedColumn = column.toLowerCase();
  const escapedColumn = normalizedColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const columnPattern = new RegExp(`\\b${escapedColumn}\\b`);
  return code === "42703" && message.includes("does not exist") && columnPattern.test(message);
}

function isAnyMissingColumn(error: unknown, columns: string[]) {
  return columns.some((column) => isMissingColumn(error, column));
}

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function normalizeDateInput(value: string | undefined) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export default async function AdminCustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const isAdmin = isAdminRole(session?.role);
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Customer Profile</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const { id } = await params;
  const query = await searchParams;
  const statusFilter = typeof query.status === "string" ? query.status.trim().toUpperCase() : "";
  const dateFrom = normalizeDateInput(typeof query.dateFrom === "string" ? query.dateFrom : undefined);
  const dateTo = normalizeDateInput(typeof query.dateTo === "string" ? query.dateTo : undefined);
  const pageSize = typeof query.pageSize === "string" ? query.pageSize : "";

  let customer;
  try {
    customer = await dbQuery<CustomerRow>(
      "select c.id, c.full_name, c.email, c.phone, coalesce(c.is_blocked, false) as is_blocked, c.blocked_at, c.blocked_by_user_id, c.blocked_reason, c.legal_id_type, c.legal_id_number, c.legal_id_image_url, c.address, c.notes, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id where c.id = $1 group by c.id, c.full_name, c.email, c.phone, c.is_blocked, c.blocked_at, c.blocked_by_user_id, c.blocked_reason, c.legal_id_type, c.legal_id_number, c.legal_id_image_url, c.address, c.notes, c.created_at, c.last_booked_at",
      [id],
    );
  } catch (error) {
    if (
      !isAnyMissingColumn(error, [
        "legal_id_type",
        "is_blocked",
        "blocked_at",
        "blocked_by_user_id",
        "blocked_reason",
      ])
    ) {
      throw error;
    }
    const legacyCustomer = await dbQuery<Omit<CustomerRow, "legal_id_type" | "legal_id_number" | "legal_id_image_url">>(
      "select c.id, c.full_name, c.email, c.phone, false as is_blocked, null::timestamptz as blocked_at, null::uuid as blocked_by_user_id, null::text as blocked_reason, c.address, c.notes, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id where c.id = $1 group by c.id, c.full_name, c.email, c.phone, c.address, c.notes, c.created_at, c.last_booked_at",
      [id],
    );
    customer = {
      ...legacyCustomer,
      rows: legacyCustomer.rows.map(
        (
          row: Omit<CustomerRow, "legal_id_type" | "legal_id_number" | "legal_id_image_url">,
        ) => ({
          ...row,
          legal_id_type: null,
          legal_id_number: null,
          legal_id_image_url: null,
        }),
      ),
    };
  }

  const customerRow = customer.rows[0];
  if (!customerRow) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <p className="text-sm text-[var(--ccr-muted)]">Customer not found.</p>
      </div>
    );
  }

  const snapshotBookingsPage = await fetchCustomerSnapshotBookingsPage({
    customerId: id,
    status: statusFilter || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    limit: pageSize || null,
    cursor: null,
  });

  const snapshotStateKey = JSON.stringify({
    status: statusFilter || "",
    dateFrom: dateFrom || "",
    dateTo: dateTo || "",
    pageSize: snapshotBookingsPage.limit,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Customer</p>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-[var(--ccr-text)]">{customerRow.full_name}</h1>
            {customerRow.is_blocked ? (
              <span className="rounded-full border border-red-400/70 bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">
                Blocked
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            {customerRow.email} · {customerRow.phone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={customerRow.is_blocked ? "#" : `/admin/bookings?create=1&customerId=${customerRow.id}`}
            aria-disabled={customerRow.is_blocked}
            className={`rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ring-1 ring-[var(--ccr-accent)] ${customerRow.is_blocked ? "pointer-events-none opacity-50" : ""}`}
          >
            New booking for customer
          </Link>
          <CustomerBlockToggleButton customerId={customerRow.id} isBlocked={customerRow.is_blocked} />
          <Link
            href="/admin/customers"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to customers
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Profile</h2>
          <CustomerProfileForm
            customerId={customerRow.id}
            fullName={customerRow.full_name}
            email={customerRow.email}
            phone={customerRow.phone}
            legalIdType={customerRow.legal_id_type}
            legalIdNumber={customerRow.legal_id_number}
            legalIdImageUrl={customerRow.legal_id_image_url}
            address={customerRow.address}
            notes={customerRow.notes}
          />
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 text-xs text-[var(--ccr-muted)]">
            <p className="font-semibold text-[var(--ccr-text)]">Legal Identification</p>
            <p className="mt-1">
              Type: {customerRow.legal_id_type ? formatLegalIdTypeLabel(customerRow.legal_id_type) : "Not provided"}
            </p>
            <p className="mt-1">Number: {customerRow.legal_id_number || "Not provided"}</p>
            {customerRow.legal_id_image_url ? (
              <a
                href={customerRow.legal_id_image_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex text-[var(--ccr-accent)] underline"
              >
                View uploaded ID image
              </a>
            ) : (
              <p className="mt-1">Image: Not provided</p>
            )}
          </div>
          <div className="mt-5 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 text-xs text-[var(--ccr-muted)]">
            <p>Created: {fmtDate(customerRow.created_at)}</p>
            <p className="mt-1">
              Last booked: {customerRow.last_booked_at ? fmtDate(customerRow.last_booked_at) : "No bookings yet"}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Customer Snapshot</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Total Bookings</p>
              <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{customerRow.total_bookings}</p>
            </div>
            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Total Spend</p>
              <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{formatJmd(customerRow.total_spend)}</p>
            </div>
          </div>
          <form action={`/admin/customers/${customerRow.id}`} method="get" className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Status
              <select
                name="status"
                defaultValue={statusFilter}
                className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="">All statuses</option>
                <option value="PENDING_PAYMENT">Pending payment</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="RETURNED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Date From
              <input
                type="date"
                name="dateFrom"
                defaultValue={dateFrom}
                className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Date To
              <input
                type="date"
                name="dateTo"
                defaultValue={dateTo}
                className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>
            <input type="hidden" name="pageSize" value={String(snapshotBookingsPage.limit)} />
            <button type="submit" className="mt-6 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/admin/customers/${customerRow.id}`}
              className="mt-6 rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Reset
            </Link>
          </form>

          <CustomerSnapshotBookingsTable
            customerId={customerRow.id}
            initialRows={snapshotBookingsPage.bookings}
            initialNextCursor={snapshotBookingsPage.nextCursor}
            initialHasMore={snapshotBookingsPage.hasMore}
            initialTotalCount={snapshotBookingsPage.totalCount}
            pageSize={snapshotBookingsPage.limit}
            filters={{
              status: statusFilter || undefined,
              dateFrom: dateFrom || undefined,
              dateTo: dateTo || undefined,
            }}
            stateKey={snapshotStateKey}
          />
        </section>
      </div>
    </div>
  );
}
