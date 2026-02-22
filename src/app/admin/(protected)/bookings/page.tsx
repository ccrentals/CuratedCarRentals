import Link from "next/link";

import { AdminBookingsTable } from "@/components/admin/AdminBookingsTable";
import { AdminCreateBookingModal } from "@/components/admin/AdminCreateBookingModal";
import BookingFilters from "@/components/admin/BookingFilters";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchAdminBookingsPage } from "@/lib/bookings/adminBookingsList";
import { normalizeBookingPageSize } from "@/lib/bookings/adminBookingsPagination";
import { dbQuery } from "@/lib/db";

type VehicleOption = {
  id: string;
  year: number;
  make: string;
  model: string;
};

type CustomerPrefill = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
};

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const canAdmin = isAdminRole(session?.role);

  const params = await searchParams;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  const rawStatus = typeof params.status === "string" ? params.status : "";
  const rawScope = typeof params.scope === "string" ? params.scope : "";
  const rawPickupDay = typeof params.pickupDay === "string" ? params.pickupDay : "";
  const rawSortBy = typeof params.sortBy === "string" ? params.sortBy.trim() : "";
  const rawSortDir = typeof params.sortDir === "string" ? params.sortDir.trim() : "";
  const rawQuery = typeof params.q === "string" ? params.q.trim() : "";
  const rawDateFrom =
    typeof params.dateFrom === "string" && datePattern.test(params.dateFrom) ? params.dateFrom : "";
  const rawDateTo =
    typeof params.dateTo === "string" && datePattern.test(params.dateTo) ? params.dateTo : "";
  const includeArchived = typeof params.archived === "string" && params.archived === "1";
  const openCreateModal = typeof params.create === "string" && params.create === "1";
  const requestedCustomerId =
    typeof params.customerId === "string" ? params.customerId.trim() : "";
  const requestedPageSize = normalizeBookingPageSize(
    typeof params.pageSize === "string" ? params.pageSize : undefined,
  );

  const bookingsPage = await fetchAdminBookingsPage({
    status: rawStatus || null,
    scope: rawScope || null,
    pickupDay: rawPickupDay || null,
    sortBy: rawSortBy || null,
    sortDir: rawSortDir || null,
    q: rawQuery || null,
    dateFrom: rawDateFrom || null,
    dateTo: rawDateTo || null,
    archived: includeArchived ? "1" : null,
    includeArchived,
    limit: requestedPageSize,
    cursor: null,
  });

  const vehicles = await dbQuery<VehicleOption>(
    "select id, year, make, model from vehicles where status <> 'INACTIVE' order by year desc, make asc, model asc",
  );

  const vehicleOptions = vehicles.rows.map((vehicle: VehicleOption) => ({
    id: vehicle.id,
    label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
  }));

  let initialCustomer: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
  } | null = null;
  if (requestedCustomerId) {
    const customer = await dbQuery<CustomerPrefill>(
      "select id, full_name, email, phone from customers where id = $1 limit 1",
      [requestedCustomerId],
    );
    const row = customer.rows[0];
    if (row) {
      initialCustomer = {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
      };
    }
  }

  const stateKey = JSON.stringify({
    scope: rawScope || "",
    pickupDay: rawPickupDay || "",
    sortBy: rawSortBy || "",
    sortDir: rawSortDir || "",
    status: rawStatus || "",
    q: rawQuery || "",
    dateFrom: rawDateFrom || "",
    dateTo: rawDateTo || "",
    archived: includeArchived ? "1" : "",
    pageSize: bookingsPage.limit,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Bookings</h1>
        </div>
        <div className="flex items-center gap-2">
          <AdminCreateBookingModal
            vehicles={vehicleOptions}
            initialOpen={openCreateModal}
            clearOpenHref={openCreateModal ? "/admin/bookings" : undefined}
            initialCustomer={initialCustomer}
          />
          {canAdmin ? (
            <Link
              href="/admin/bookings/archive"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Archive
            </Link>
          ) : null}
          <Link
            href="/admin/bookings"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset
          </Link>
        </div>
      </div>

      {bookingsPage.archiveNotConfigured ? (
        <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Archive not configured</p>
          <p className="mt-1 text-xs text-amber-100/80">
            The archive columns are missing in the connected database. Apply the archive section from
            schema.sql to enable hiding archived bookings.
          </p>
        </div>
      ) : null}

      <BookingFilters canAdmin={canAdmin} />

      <AdminBookingsTable
        initialRows={bookingsPage.bookings}
        initialNextCursor={bookingsPage.nextCursor}
        initialHasMore={bookingsPage.hasMore}
        initialTotalCount={bookingsPage.totalCount}
        pageSize={bookingsPage.limit}
        filters={{
          scope: rawScope || undefined,
          pickupDay: rawPickupDay || undefined,
          sortBy: rawSortBy || undefined,
          sortDir: rawSortDir || undefined,
          status: rawStatus || undefined,
          q: rawQuery || undefined,
          dateFrom: rawDateFrom || undefined,
          dateTo: rawDateTo || undefined,
          archived: includeArchived ? "1" : undefined,
        }}
        stateKey={stateKey}
      />
    </div>
  );
}
