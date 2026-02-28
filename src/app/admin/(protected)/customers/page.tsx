import Link from "next/link";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";
import { CustomerBlockToggleButton } from "@/components/admin/CustomerBlockToggleButton";
import { CreateCustomerForm } from "@/components/admin/CreateCustomerForm";
import { CustomersExportMenu } from "@/components/admin/CustomersExportMenu";
import { CustomersFilters } from "@/components/admin/CustomersFilters";
import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { SortableTh } from "@/components/admin/SortableTh";
import {
  applySortToSearchParams,
  nextSort,
  readSortFromSearchParams,
  type SortDir,
} from "@/components/admin/tableSort";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";

type CustomerListRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  is_blocked: boolean;
  created_at: string;
  last_booked_at: string | null;
  total_bookings: number;
  total_spend: number;
};

const CUSTOMER_SORT_COLUMNS = ["customer", "bookings", "totalSpend", "lastBooked", "created"] as const;
type CustomerSortBy = (typeof CUSTOMER_SORT_COLUMNS)[number];
type CustomerSortDir = SortDir;

function normalizeCustomerSort(
  params: URLSearchParams,
): { sortBy: CustomerSortBy; sortDir: CustomerSortDir } {
  const sort = readSortFromSearchParams(params, {
    allowedSortBy: CUSTOMER_SORT_COLUMNS,
    defaultSortBy: "lastBooked",
    defaultSortDir: "desc",
    legacySortParam: "sort",
    legacySortMap: {
      last_booked: { sortBy: "lastBooked", sortDir: "desc" },
      total_bookings: { sortBy: "bookings", sortDir: "desc" },
      total_spend: { sortBy: "totalSpend", sortDir: "desc" },
    },
  });

  return {
    sortBy: (sort.sortBy as CustomerSortBy | undefined) ?? "lastBooked",
    sortDir: (sort.sortDir as CustomerSortDir | undefined) ?? "desc",
  };
}

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.toLowerCase().includes(column.toLowerCase());
}

async function fetchCustomers({
  q,
  sortBy,
  sortDir,
}: {
  q: string;
  sortBy: CustomerSortBy;
  sortDir: CustomerSortDir;
}) {
  const whereSql = q
    ? "where c.full_name ilike $1 or c.email ilike $1 or c.phone ilike $1"
    : "";
  const values = q ? [`${q}%`] : [];
  const direction = sortDir === "asc" ? "asc" : "desc";

  const orderBy =
    sortBy === "customer"
      ? `order by lower(c.full_name) ${direction}, lower(c.email) ${direction}, c.id::text ${direction}`
      : sortBy === "bookings"
        ? `order by total_bookings ${direction}, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc`
        : sortBy === "totalSpend"
          ? `order by total_spend ${direction}, coalesce(c.last_booked_at, max(b.created_at), c.created_at) desc`
          : sortBy === "created"
            ? `order by c.created_at ${direction}, c.id::text ${direction}`
            : `order by coalesce(c.last_booked_at, max(b.created_at), c.created_at) ${direction}, c.id::text ${direction}`;

  const queryWithDeletedColumn =
    "select c.id, c.full_name, c.email, c.phone, coalesce(c.is_blocked, false) as is_blocked, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') and p.deleted_at is null then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
    whereSql +
    " group by c.id, c.full_name, c.email, c.phone, c.is_blocked, c.created_at, c.last_booked_at " +
    orderBy;

  try {
    return await dbQuery<CustomerListRow>(queryWithDeletedColumn, values);
  } catch (error) {
    if (!isMissingColumn(error, "deleted_at") && !isMissingColumn(error, "is_blocked")) throw error;
    const fallback =
      "select c.id, c.full_name, c.email, c.phone, false as is_blocked, c.created_at, c.last_booked_at, count(distinct b.id)::int as total_bookings, coalesce(sum(case when p.status in ('DEPOSIT_PAID', 'SUCCESS', 'REFUNDED') then p.deposit_amount_cents else 0 end), 0)::int as total_spend from customers c left join bookings b on b.customer_id = c.id left join payments p on p.booking_id = b.id " +
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
  const isStaff = isStaffRole(session?.role);

  if (!isStaff) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Customers</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") queryParams.set(key, value);
  }
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const sort = normalizeCustomerSort(queryParams);
  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);
  const customers = await fetchCustomers({ q, sortBy: sort.sortBy, sortDir: sort.sortDir });
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);
  const visibleCustomers = customers.rows.slice(0, visibleCount);

  const sortHref = (columnKey: CustomerSortBy, defaultDirection: SortDir) => {
    const next = nextSort(sort, columnKey, defaultDirection);
    const nextParams = applySortToSearchParams(queryParams, next);
    const qs = nextParams.toString();
    return qs ? `/admin/customers?${qs}` : "/admin/customers";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Customers</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Track customer profiles, booking history, and booking activity.
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <CustomersExportMenu q={q} sortBy={sort.sortBy} sortDir={sort.sortDir} />
          <CreateCustomerForm />
          <Link
            href="/admin/bookings?create=1"
            className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ring-1 ring-[var(--ccr-accent)] sm:w-auto"
          >
            New Booking
          </Link>
        </div>
      </div>

      <CustomersFilters initialQuery={q} />

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {customers.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No customers found.
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--ccr-border)] md:hidden">
              {visibleCustomers.map((customer: CustomerListRow) => (
                <article key={`mobile-${customer.id}`} className="space-y-3 px-4 py-4">
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="block rounded-lg border border-transparent p-1 -m-1 transition hover:border-[var(--ccr-border)]"
                  >
                    <p className="font-semibold text-[var(--ccr-text)]">{customer.full_name}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">{customer.email}</p>
                  </Link>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Phone</dt>
                      <dd className="font-semibold text-[var(--ccr-text)]">{customer.phone || "—"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Bookings</dt>
                      <dd className="font-semibold text-[var(--ccr-text)]">{customer.total_bookings}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Total spend</dt>
                      <dd className="font-semibold text-[var(--ccr-text)]">
                        {formatJmd(customer.total_spend)}
                      </dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-[var(--ccr-muted)]">Last booked</dt>
                      <dd className="font-semibold text-[var(--ccr-text)]">
                        {customer.last_booked_at ? (
                          <DateTimeInline
                            value={customer.last_booked_at}
                            className="font-semibold text-[var(--ccr-text)]"
                          />
                        ) : (
                          "No bookings yet"
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={customer.is_blocked ? "#" : `/admin/bookings?create=1&customerId=${customer.id}`}
                      aria-disabled={customer.is_blocked}
                      className={`whitespace-nowrap rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ${customer.is_blocked ? "pointer-events-none opacity-50" : ""}`}
                    >
                      New Booking
                    </Link>
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                    >
                      View
                    </Link>
                    {isAdmin ? (
                      <CustomerBlockToggleButton customerId={customer.id} isBlocked={customer.is_blocked} />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <SortableTh
                      label="Customer"
                      columnKey="customer"
                      sort={sort}
                      href={sortHref("customer", "asc")}
                    />
                    <th className="px-4 py-3">Phone</th>
                    <SortableTh
                      label="Bookings"
                      columnKey="bookings"
                      sort={sort}
                      href={sortHref("bookings", "desc")}
                    />
                    <SortableTh
                      label="Total Spend"
                      columnKey="totalSpend"
                      sort={sort}
                      href={sortHref("totalSpend", "desc")}
                    />
                    <SortableTh
                      label="Last Booked"
                      columnKey="lastBooked"
                      sort={sort}
                      href={sortHref("lastBooked", "desc")}
                    />
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map((customer: CustomerListRow) => (
                    <tr key={customer.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="block rounded-lg border border-transparent p-1 -m-1 transition hover:border-[var(--ccr-border)]"
                        >
                          <p className="font-semibold text-[var(--ccr-text)]">{customer.full_name}</p>
                          <p className="text-xs text-[var(--ccr-muted)]">{customer.email}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{customer.phone}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">{customer.total_bookings}</td>
                      <td className="px-4 py-3 text-[var(--ccr-text)]">
                        {formatJmd(customer.total_spend)}
                      </td>
                      <td className="px-4 py-3 text-[var(--ccr-muted)]">
                        {customer.last_booked_at ? (
                          <TableDateTime value={customer.last_booked_at} />
                        ) : (
                          "No bookings yet"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={customer.is_blocked ? "#" : `/admin/bookings?create=1&customerId=${customer.id}`}
                            aria-disabled={customer.is_blocked}
                            className={`whitespace-nowrap rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] ${customer.is_blocked ? "pointer-events-none opacity-50" : ""}`}
                          >
                            New Booking
                          </Link>
                          <Link
                            href={`/admin/customers/${customer.id}`}
                            className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                          >
                            View
                          </Link>
                          {isAdmin ? (
                            <CustomerBlockToggleButton customerId={customer.id} isBlocked={customer.is_blocked} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {customers.rows.length > 0 ? (
          <LoadMorePaginationControls
            pageSize={rowsPerPage}
            loadedCount={visibleCustomers.length}
            totalCount={customers.rows.length}
            noMoreLabel="No more customers"
          />
        ) : null}
      </div>
    </div>
  );
}
