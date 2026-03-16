import Link from "next/link";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { InlineDateTimeRange } from "@/components/shared/InlineDateTimeRange";
import {
  fetchDashboardBookingSnapshot,
  type AdminBookingListItem,
} from "@/lib/bookings/adminBookingsList";
import { bookingStartSqlExpr, buildUpcomingWhereSql, getStartOfToday } from "@/lib/bookings/upcoming";
import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import {
  fetchActiveFleetSnapshot,
  summarizeActiveFleetSnapshot,
  type ActiveFleetVehicleSnapshot,
} from "@/lib/vehicles/adminFleetSnapshot";
import { vehicleDerivedStatusLabel } from "@/lib/vehicles/adminVehicles";

function formatDashboardStatus(status: string) {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function AdminDashboardPage() {
  const now = new Date();
  const todayLabel = now.toLocaleDateString();
  const hoverTextClass = "hover:text-[var(--ccr-muted)]";
  // Shared gold-ring quick action treatment for visual consistency.
  const quickActionClass =
    `rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-1 ring-[var(--ccr-accent)] ring-offset-1 ring-offset-[var(--ccr-surface)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)] ${hoverTextClass}`;
  const [activeFleetRows, bookingSnapshot] = await Promise.all([
    fetchActiveFleetSnapshot({ now }),
    fetchDashboardBookingSnapshot({ now }),
  ]);
  const fleetSummary = summarizeActiveFleetSnapshot(activeFleetRows);
  const upcomingWhere = buildUpcomingWhereSql({
    bookingAlias: "b",
    paramStartIndex: 1,
    now,
    mode: "upcoming",
  });
  const upcomingWindowEnd = new Date(getStartOfToday(now).getTime() + 8 * 24 * 60 * 60 * 1000);
  const upcomingPickupsResult = await dbQuery<{ count: string }>(
    "select count(*) from bookings b where " +
      upcomingWhere.clause +
      ` and ${bookingStartSqlExpr("b")} < $${upcomingWhere.nextParamIndex}::timestamptz`,
    [...upcomingWhere.values, upcomingWindowEnd.toISOString()],
  );

  const pickupsTodayWhere = buildUpcomingWhereSql({
    bookingAlias: "b",
    paramStartIndex: 1,
    now,
    mode: "pickup_today",
  });
  const pickupsToday = await dbQuery<{
    id: string;
    public_id: string;
    status: string;
    start_at: string;
    start_date: string;
    end_date: string;
    customer_name: string;
    vehicle_make: string;
    vehicle_model: string;
  }>(
    "select b.id, b.public_id, b.status, coalesce(b.start_at, b.start_date::timestamptz) as start_at, b.start_date, b.end_date, c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where " +
      pickupsTodayWhere.clause +
      ` order by ${bookingStartSqlExpr("b")} asc, b.created_at desc limit 5`,
    pickupsTodayWhere.values,
  );

  const outstandingBalances = await dbQuery<{
    id: string;
    public_id: string;
    status: string;
    start_date: string;
    end_date: string;
    customer_name: string;
    customer_email: string;
    vehicle_make: string;
    vehicle_model: string;
    balance_due: string;
  }>(
    "with booking_financials as (" +
      "  select b.id, b.public_id, b.status, b.start_date, b.end_date, b.created_at, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, " +
      "    greatest(0, " +
      "      coalesce(" +
      "        case when coalesce(b.pricing_json->>'total_cents', '') ~ '^-?[0-9]+(\\\\.[0-9]+)?$' then (b.pricing_json->>'total_cents')::numeric else null end, " +
      "        coalesce(" +
      "          case when coalesce(b.pricing_json->>'subtotal_cents', '') ~ '^-?[0-9]+(\\\\.[0-9]+)?$' then (b.pricing_json->>'subtotal_cents')::numeric else null end, " +
      "          (v.daily_rate_cents::numeric * greatest((b.end_date - b.start_date + 1), 1))" +
      "        ) - coalesce(" +
      "          case when coalesce(b.pricing_json->>'promo_discount_cents', '') ~ '^-?[0-9]+(\\\\.[0-9]+)?$' then (b.pricing_json->>'promo_discount_cents')::numeric else 0 end, " +
      "          0" +
      "        )" +
      "      ) - coalesce((" +
      "        select sum(p.deposit_amount_cents)::numeric from payments p " +
      "        where p.booking_id = b.id and p.deleted_at is null and p.status = any(array['DEPOSIT_PAID','SUCCESS','REFUNDED']::text[])" +
      "      ), 0)" +
      "    ) as balance_due " +
      "  from bookings b " +
      "  join customers c on c.id = b.customer_id " +
      "  join vehicles v on v.id = b.vehicle_id " +
      "  where b.status not in ('CANCELLED','OVERRIDDEN') " +
      "    and coalesce(b.pricing_json->>'overridden_by_booking_id', '') = ''" +
      ") " +
      "select id, public_id, status, start_date, end_date, customer_name, customer_email, vehicle_make, vehicle_model, balance_due::text as balance_due " +
      "from booking_financials " +
      "where balance_due > 0 " +
      "order by balance_due desc, created_at desc limit 5",
  );

  const maintenanceVehicles = activeFleetRows
    .filter((vehicle) => vehicle.derived_status === "DIRTY")
    .sort((left, right) => {
      const leftTime = new Date(left.updated_at).getTime();
      const rightTime = new Date(right.updated_at).getTime();
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.id.localeCompare(left.id);
    })
    .slice(0, 5);
  const recentBookings = bookingSnapshot.recentBookings;
  const recentVehicles = fleetSummary.recentVehicles;

  const cards = [
    {
      label: "Total Bookings",
      value: String(bookingSnapshot.counts.totalBookings),
      href: "/admin/bookings",
    },
    {
      label: "Pending Payment",
      value: String(bookingSnapshot.counts.pendingPayment),
      href: "/admin/bookings?status=pending_payment",
    },
    {
      label: "Confirmed",
      value: String(bookingSnapshot.counts.confirmed),
      href: "/admin/bookings?status=confirmed",
    },
    {
      label: "Total Vehicles",
      value: String(fleetSummary.totalVehicles),
      href: "/admin/vehicles",
    },
    {
      label: "Available Vehicles",
      value: String(fleetSummary.availableVehicles),
      href: "/admin/vehicles?fleet=available",
    },
    {
      label: "Upcoming Pickups (7d)",
      value: upcomingPickupsResult.rows[0]?.count ?? "0",
      href: "/admin/bookings?scope=upcoming",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)] sm:text-3xl">Admin Dashboard</h1>
        <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:justify-end sm:gap-5">
          <Link
            href="/admin/bookings"
            className={`inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--ccr-surface)] px-3 py-2 text-center text-xs font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-bg)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)] sm:h-auto sm:w-auto sm:px-4 sm:text-sm ${hoverTextClass}`}
          >
            View Bookings
          </Link>
          <Link
            href="/admin/vehicles"
            className={`inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--ccr-surface)] px-3 py-2 text-center text-xs font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-bg)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)] sm:h-auto sm:w-auto sm:px-4 sm:text-sm ${hoverTextClass}`}
          >
            Manage Vehicles
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ccr-accent)] hover:shadow-md sm:p-5 ${hoverTextClass}`}
          >
            <p className="break-words text-xs text-[var(--ccr-muted)] sm:text-sm">{card.label}</p>
            <p className="mt-2 text-xl font-bold text-[var(--ccr-text)] sm:text-2xl">{card.value}</p>
          </Link>
        ))}
      </div>

      <section className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Scope legend</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ccr-muted)]">
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1">
            Cards: operational snapshot
          </span>
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1">
            Booking cards: archived + cancelled hidden by default
          </span>
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1">
            Vehicle cards: active fleet with derived status
          </span>
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1">
            Upcoming pickups today: {todayLabel}
          </span>
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1">
            Upcoming pickups (7d): next 7 days
          </span>
          <span className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2.5 py-1">
            Outstanding balances: open bookings only
          </span>
        </div>
        {bookingSnapshot.archiveNotConfigured ? (
          <p className="mt-3 text-xs text-[var(--ccr-muted)]">
            Archive columns are not configured in the connected database, so booking cards are using the
            same fallback scope as the bookings list.
          </p>
        ) : null}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Upcoming pickups today</h2>
            <Link
              href="/admin/bookings?scope=upcoming"
              className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
            >
              View all
            </Link>
          </div>
          {pickupsToday.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No pickups today.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(pickupsToday.rows as Array<{
                id: string;
                public_id: string;
                status: string;
                start_at: string;
                start_date: string;
                end_date: string;
                customer_name: string;
                vehicle_make: string;
                vehicle_model: string;
              }>).map((booking) => {
                const bookingPublicId = String(booking.public_id ?? "").trim() || booking.id;
                return (
                  <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/bookings/${booking.id}`}
                          className={`inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface)] ${hoverTextClass}`}
                          title="Open booking"
                        >
                          {bookingPublicId}
                        </Link>
                        <p className="mt-1 break-words text-xs text-[var(--ccr-muted)]">
                          {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                        </p>
                        <p className="text-xs text-[var(--ccr-muted)]">
                          <InlineDateTimeRange
                            startLabel={fmtDate(booking.start_date)}
                            endLabel={fmtDate(booking.end_date)}
                          />
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                          {formatDashboardStatus(booking.status)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Outstanding balances</h2>
            <Link href="/admin/bookings" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
              View bookings
            </Link>
          </div>
          {outstandingBalances.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No outstanding balances.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(outstandingBalances.rows as Array<{
                id: string;
                public_id: string;
                status: string;
                start_date: string;
                end_date: string;
                customer_name: string;
                customer_email: string;
                vehicle_make: string;
                vehicle_model: string;
                balance_due: string;
              }>).map((booking) => {
                const balanceDue = Number(booking.balance_due ?? 0);
                const bookingPublicId = String(booking.public_id ?? "").trim() || booking.id;
                return (
                  <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)]">
                    <details className="group">
                      <summary className="list-none cursor-pointer p-3 [&::-webkit-details-marker]:hidden">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)]">
                              {bookingPublicId}
                            </span>
                            <p className="mt-1 text-xs text-[var(--ccr-muted)]">Booking details</p>
                          </div>
                          <div className="flex shrink-0 items-start gap-3 text-right">
                            <div>
                              <p className="text-xs font-semibold text-[var(--ccr-muted)]">Balance</p>
                              <p className="font-bold text-[var(--ccr-text)]">{formatJmd(balanceDue)}</p>
                            </div>
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--ccr-border)] text-[var(--ccr-text)] transition-transform group-open:rotate-180">
                              <svg
                                viewBox="0 0 20 20"
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M5 7l5 6 5-6" />
                              </svg>
                            </span>
                          </div>
                        </div>
                      </summary>
                      <div className="border-t border-[var(--ccr-border)] px-3 pb-3 pt-2">
                        <p className="break-words text-xs text-[var(--ccr-muted)]">
                          {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                        </p>
                        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                          <InlineDateTimeRange
                            startLabel={fmtDate(booking.start_date)}
                            endLabel={fmtDate(booking.end_date)}
                          />
                        </p>
                        <Link
                          href={`/admin/bookings/${booking.id}`}
                          className={`mt-2 inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface)] ${hoverTextClass}`}
                          title="Open booking"
                        >
                          Open booking
                        </Link>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Dirty / maintenance vehicles</h2>
            <Link href="/admin/vehicles" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
              View vehicles
            </Link>
          </div>
          {maintenanceVehicles.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No dirty or maintenance vehicles.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {maintenanceVehicles.map((vehicle) => (
                <li key={vehicle.id} className="rounded-xl border border-[var(--ccr-border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/admin/vehicles/${vehicle.id}`}
                        className={`font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
                      >
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </Link>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        Updated{" "}
                        <DateTimeInline
                          value={vehicle.updated_at}
                          className="inline-flex text-[var(--ccr-muted)]"
                        />
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                      {vehicleDerivedStatusLabel(vehicle.derived_status)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Quick actions</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/admin/bookings?create=1"
              className={`${quickActionClass} inline-flex w-full items-center justify-center sm:w-auto`}
            >
              Quick create booking
            </Link>
            <Link
              href="/admin/calendar"
              className={`${quickActionClass} inline-flex w-full items-center justify-center sm:w-auto`}
            >
              Add blockout
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recent Bookings</h2>
            <Link href="/admin/bookings" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
              View all
            </Link>
          </div>
          {recentBookings.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No bookings yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(recentBookings as AdminBookingListItem[]).map((booking) => (
                <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)]">
                  <details className="group">
                    <summary className="list-none cursor-pointer p-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)]">
                            {booking.publicId || booking.id}
                          </span>
                          <p className="mt-1 text-xs text-[var(--ccr-muted)]">Booking details</p>
                        </div>
                        <div className="flex shrink-0 items-start gap-3">
                          <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                            {booking.statusLabel}
                          </span>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--ccr-border)] text-[var(--ccr-text)] transition-transform group-open:rotate-180">
                            <svg
                              viewBox="0 0 20 20"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 7l5 6 5-6" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </summary>
                    <div className="border-t border-[var(--ccr-border)] px-3 pb-3 pt-2">
                      <p className="break-words text-xs text-[var(--ccr-muted)]">
                        {booking.customerName} • {booking.vehicleLabel}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                        <InlineDateTimeRange
                          startLabel={booking.startDateLabel}
                          endLabel={booking.endDateLabel}
                        />
                      </p>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className={`mt-2 inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface)] ${hoverTextClass}`}
                        title="Open booking"
                      >
                        Open booking
                      </Link>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recent Vehicles</h2>
            <Link href="/admin/vehicles" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
              View all
            </Link>
          </div>
          {recentVehicles.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No vehicles yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(recentVehicles as ActiveFleetVehicleSnapshot[]).map((vehicle) => (
                <li key={vehicle.id} className="rounded-xl border border-[var(--ccr-border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/admin/vehicles/${vehicle.id}`}
                        className={`font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
                      >
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </Link>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        Added{" "}
                        <DateTimeInline
                          value={vehicle.created_at}
                          className="inline-flex text-[var(--ccr-muted)]"
                        />
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                      {vehicleDerivedStatusLabel(vehicle.derived_status)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
