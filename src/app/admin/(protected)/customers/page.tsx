import Link from "next/link";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

type CustomerListRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  created_at: string;
  last_booked_at: string | null;
  total_bookings: number;
  total_spend: number;
};

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function normalizeSort(value: string | undefined): "last_booked" | "total_bookings" | "total_spend" {
  if (value === "total_bookings") return "total_bookings";
  if (value === "total_spend") return "total_spend";
  return "last_booked";
}

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.toLowerCase().includes(column.toLowerCase());
}

async function fetchCustomers({
  q,
  sort,
}: {
  q: string;
  sort: "last_booked" | "total_bookings" | "total_spend";
}) {
  const whereSql = q
    ? "where c.full_name ilike $1 or c.email ilike $1 or c.phone ilike $1"
    : "";
  const values = q ? [`%${q}%`] : [];

  const orderBy =
    sort === "total_bookings"
      ? "order by total_bookings desc, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc"
      : sort === "total_spend"
        ? "order by total_spend desc, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc"
        : "order by coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc";

  const queryWithDeletedColumn =
    "select c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
    whereSql +
    " group by c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at " +
    orderBy;

  try {
    return await dbQuery<CustomerListRow>(queryWithDeletedColumn, values);
  } catch (error) {
    if (!isMissingColumn(error, "deleted_at")) throw error;
    const fallback =
      "select c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
      whereSql +
      " group by c.id, c.full_name, c.email, c.phone, c.created_at, c.last_booked_at " +
      orderBy;
    try {
      return await dbQuery<CustomerListRow>(fallback, values);
    } catch (secondError) {
      if (!isMissingColumn(secondError, "last_booked_at")) throw secondError;
      const fallbackWithoutLastBooked =
        "select c.id, c.full_name, c.email, c.phone, c.created_at, null::timestamptz as last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
        whereSql +
        " group by c.id, c.full_name, c.email, c.phone, c.created_at " +
        orderBy.replace(/c\.last_booked_at, /g, "");
      return await dbQuery<CustomerListRow>(fallbackWithoutLastBooked, values);
    }
  }
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const isAdmin = isAdminRole(session?.role);

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Customers</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const sort = normalizeSort(typeof params.sort === "string" ? params.sort : undefined);
  const customers = await fetchCustomers({ q, sort });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Customers</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Track customer profiles, booking history, and booking activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/api/admin/customers?export=csv${q ? `&q=${encodeURIComponent(q)}` : ""}&sort=${sort}`}
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Export CSV
          </Link>
          <Link
            href="/admin/bookings?create=1"
            className="rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ring-1 ring-[var(--ccr-accent)]"
          >
            New booking
          </Link>
        </div>
      </div>

      <form action="/admin/customers" method="get" className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto_auto]">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Search
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name, email, or phone"
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Sort
            <select
              name="sort"
              defaultValue={sort}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="last_booked">Last Booked</option>
              <option value="total_bookings">Most Bookings</option>
              <option value="total_spend">Highest Spend</option>
            </select>
          </label>
          <button
            type="submit"
            className="mt-6 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white"
          >
            Apply
          </button>
          <Link
            href="/admin/customers"
            className="mt-6 rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset
          </Link>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {customers.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No customers found.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Bookings</th>
                <th className="px-4 py-3">Total Spend</th>
                <th className="px-4 py-3">Last Booked</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.rows.map((customer: CustomerListRow) => (
                <tr key={customer.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--ccr-text)]">{customer.full_name}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">{customer.email}</p>
                    <p className="mt-1 font-mono text-[10px] text-[var(--ccr-muted)]">{customer.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{customer.phone}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{customer.total_bookings}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{formatJmd(customer.total_spend)}</td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    {customer.last_booked_at ? fmtDate(customer.last_booked_at) : "No bookings yet"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/bookings?create=1&customerId=${customer.id}`}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        New booking
                      </Link>
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
