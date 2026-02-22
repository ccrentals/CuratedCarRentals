import Link from "next/link";
import { notFound } from "next/navigation";

import { DateTimeStack } from "@/components/shared/DateTimeStack";
import { CustomerSnapshotBookingsTable } from "@/components/admin/CustomerSnapshotBookingsTable";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchCustomerSnapshotBookingsPage } from "@/lib/customers/customerSnapshotBookings";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { CustomerProfileForm } from "@/components/admin/CustomerProfileForm";
import { formatLegalIdTypeLabel } from "@/lib/customers/legalId";
import { CustomerBlockToggleButton } from "@/components/admin/CustomerBlockToggleButton";

type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  birthday: string | null;
  drivers_license_number: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  blocked_reason: string | null;
  legal_id_type: string | null;
  legal_id_number: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  last_booked_at: string | null;
  total_bookings: number;
  total_spend: number;
};

type CustomerPrivateDocRow = {
  booking_id: string;
  document_type: string;
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
      "select c.id, c.full_name, c.email, c.phone, c.first_name, c.last_name, c.street, c.street2, c.city, c.state, c.zip, c.country, c.birthday::text as birthday, c.drivers_license_number, coalesce(c.is_blocked, false) as is_blocked, c.blocked_at, c.blocked_by_user_id, c.blocked_reason, c.legal_id_type, c.legal_id_number, c.address, c.notes, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id where c.id = $1 group by c.id, c.full_name, c.email, c.phone, c.first_name, c.last_name, c.street, c.street2, c.city, c.state, c.zip, c.country, c.birthday, c.drivers_license_number, c.is_blocked, c.blocked_at, c.blocked_by_user_id, c.blocked_reason, c.legal_id_type, c.legal_id_number, c.address, c.notes, c.created_at, c.last_booked_at",
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
        "first_name",
        "last_name",
        "street",
        "street2",
        "city",
        "state",
        "zip",
        "country",
        "birthday",
        "drivers_license_number",
      ])
    ) {
      throw error;
    }
    const legacyCustomer = await dbQuery<Omit<CustomerRow, "legal_id_type" | "legal_id_number">>(
      "select c.id, c.full_name, c.email, c.phone, false as is_blocked, null::timestamptz as blocked_at, null::uuid as blocked_by_user_id, null::text as blocked_reason, c.address, c.notes, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id where c.id = $1 group by c.id, c.full_name, c.email, c.phone, c.address, c.notes, c.created_at, c.last_booked_at",
      [id],
    );
    customer = {
      ...legacyCustomer,
      rows: legacyCustomer.rows.map(
        (
          row: Omit<CustomerRow, "legal_id_type" | "legal_id_number">,
        ) => ({
          ...row,
          first_name: null,
          last_name: null,
          street: null,
          street2: null,
          city: null,
          state: null,
          zip: null,
          country: null,
          birthday: null,
          drivers_license_number: null,
          legal_id_type: null,
          legal_id_number: null,
        }),
      ),
    };
  }

  const customerRow = customer.rows[0];
  if (!customerRow) {
    notFound();
  }

  let latestDriversLicenseBookingId: string | null = null;
  let latestSignatureBookingId: string | null = null;
  try {
    const privateDocsResult = await dbQuery<CustomerPrivateDocRow>(
      "select bpf.booking_id, bpf.document_type from booking_private_files bpf join bookings b on b.id = bpf.booking_id where b.customer_id = $1 and bpf.document_type in ('DRIVERS_LICENSE', 'SIGNATURE') order by bpf.created_at desc",
      [id],
    );
    for (const row of privateDocsResult.rows as CustomerPrivateDocRow[]) {
      if (row.document_type === "DRIVERS_LICENSE" && !latestDriversLicenseBookingId) {
        latestDriversLicenseBookingId = row.booking_id;
      }
      if (row.document_type === "SIGNATURE" && !latestSignatureBookingId) {
        latestSignatureBookingId = row.booking_id;
      }
      if (latestDriversLicenseBookingId && latestSignatureBookingId) break;
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "42P01") {
      throw error;
    }
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
            firstName={customerRow.first_name}
            lastName={customerRow.last_name}
            street={customerRow.street}
            street2={customerRow.street2}
            city={customerRow.city}
            state={customerRow.state}
            zip={customerRow.zip}
            country={customerRow.country}
            birthday={customerRow.birthday}
            driversLicenseNumber={customerRow.drivers_license_number}
            address={customerRow.address}
            notes={customerRow.notes}
          />
          <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 text-xs text-[var(--ccr-muted)]">
            <p className="font-semibold text-[var(--ccr-text)]">Legal Identification</p>
            <p className="mt-1">
              Type: {customerRow.legal_id_type ? formatLegalIdTypeLabel(customerRow.legal_id_type) : "Not provided"}
            </p>
            <p className="mt-1">Number: {customerRow.legal_id_number || "Not provided"}</p>
            <p className="mt-1">Driver&apos;s License Number: {customerRow.drivers_license_number || "Not provided"}</p>
            {latestDriversLicenseBookingId ? (
              <a
                href={`/admin/bookings/${latestDriversLicenseBookingId}/private-files/DRIVERS_LICENSE`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-[var(--ccr-accent)] underline"
              >
                View secure driver&apos;s license file
              </a>
            ) : null}
            {latestSignatureBookingId ? (
              <a
                href={`/admin/bookings/${latestSignatureBookingId}/private-files/SIGNATURE`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex text-[var(--ccr-accent)] underline"
              >
                View secure signature file
              </a>
            ) : null}
          </div>
          <div className="mt-5 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-3 text-xs text-[var(--ccr-muted)]">
            <p>
              Created:{" "}
              <DateTimeStack
                value={customerRow.created_at}
                className="inline-flex text-[var(--ccr-text)]"
              />
            </p>
            <p className="mt-1">
              Last booked:{" "}
              {customerRow.last_booked_at ? (
                <DateTimeStack
                  value={customerRow.last_booked_at}
                  className="inline-flex text-[var(--ccr-text)]"
                />
              ) : (
                "No bookings yet"
              )}
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
