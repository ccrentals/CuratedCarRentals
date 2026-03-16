"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BlockoutModal } from "@/components/admin/BlockoutModal";
import { CALENDAR_BOOKING_STATUS_OPTIONS } from "@/lib/bookings/adminCalendar";
import { deriveBookingPhase, type DerivedBookingPhase } from "@/lib/vehicles/vehicleStatus";

type VehicleOption = {
  id: string;
  make: string;
  model: string;
};

type BookingEvent = {
  id: string;
  status: string;
  archived_at?: string | null;
  start_at: string | null;
  end_at?: string | null;
  start_date: string;
  end_date: string;
  pricing_json?: Record<string, unknown> | null;
  pickup_location?: string;
  customer_name: string;
  vehicle_id: string;
  vehicle_make: string;
  vehicle_model: string;
};

type BlockoutEvent = {
  id: string;
  vehicle_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes?: string | null;
  vehicle_make: string;
  vehicle_model: string;
};

type CalendarViewProps = {
  view: "month" | "week";
  baseDate: string;
  days: string[];
  bookings: BookingEvent[];
  blockouts: BlockoutEvent[];
  vehicles: VehicleOption[];
  dayViewBookingLimit: number | "all";
  filters: {
    vehicleId?: string;
    customerQuery?: string;
    showBookings: boolean;
    showBlockouts: boolean;
    status?: string;
  };
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_DAY_BOOKING_LIMIT = 5;

function parseDateKey(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number") {
    const numeric = new Date(value);
    if (!Number.isNaN(numeric.getTime())) {
      return new Date(numeric.getFullYear(), numeric.getMonth(), numeric.getDate());
    }
  }
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDateKey(date: Date) {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function addMonths(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + amount);
  return copy;
}

function dayRange(dateKey: string) {
  const date = parseDateKey(dateKey) ?? new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function overlapsDay(start: Date, end: Date, dayKey: string) {
  const { start: dayStart, end: dayEnd } = dayRange(dayKey);
  return start < dayEnd && end > dayStart;
}

function bookingPhaseBadge(phase: DerivedBookingPhase) {
  if (phase === "UPCOMING") {
    return {
      label: "Upcoming",
      className:
        "rounded-full border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-status-info-text)]",
    };
  }
  if (phase === "ON_RENT") {
    return {
      label: "On Rent",
      className:
        "rounded-full border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-status-success-text)]",
    };
  }
  return null;
}

export function CalendarView({
  view,
  baseDate,
  days,
  bookings,
  blockouts,
  vehicles,
  dayViewBookingLimit,
  filters,
}: CalendarViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<string>(baseDate);
  const [showAllDayBookings, setShowAllDayBookings] = useState(false);
  const [showAllDayBlockouts, setShowAllDayBlockouts] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeBlockout, setActiveBlockout] = useState<BlockoutEvent | null>(null);
  const dayViewRef = useRef<HTMLElement | null>(null);

  const base = parseDateKey(baseDate) ?? new Date();
  const activeSelectedDate = days.includes(selectedDate) ? selectedDate : baseDate;

  const updateParams = (updates: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const dayEvents = useMemo(() => {
    const map = new Map<string, { bookings: BookingEvent[]; blockouts: BlockoutEvent[] }>();
    days.forEach((day) => map.set(day, { bookings: [], blockouts: [] }));
    const normalizedCustomerQuery = (filters.customerQuery ?? "").trim().toLowerCase();

    bookings.forEach((booking) => {
      if (
        normalizedCustomerQuery &&
        !booking.customer_name.toLowerCase().includes(normalizedCustomerQuery)
      ) {
        return;
      }
      days.forEach((day) => {
        const dayDate = parseDateKey(day);
        if (!dayDate) return;
        const start = parseDateKey(booking.start_date);
        const end = parseDateKey(booking.end_date);
        if (!start || !end) return;
        const endInclusive = new Date(end);
        endInclusive.setHours(23, 59, 59, 999);
        if (overlapsDay(start, endInclusive, day)) {
          map.get(day)?.bookings.push(booking);
        }
      });
    });

    blockouts.forEach((blockout) => {
      const start = new Date(blockout.start_at);
      const end = new Date(blockout.end_at);
      days.forEach((day) => {
        if (overlapsDay(start, end, day)) {
          map.get(day)?.blockouts.push(blockout);
        }
      });
    });

    return map;
  }, [bookings, blockouts, days, filters.customerQuery]);

  const customerSuggestions = useMemo(() => {
    const query = (filters.customerQuery ?? "").trim().toLowerCase();
    if (query.length < 3) return [];
    const names = new Set<string>();
    bookings.forEach((booking) => {
      if (booking.customer_name.toLowerCase().includes(query)) {
        names.add(booking.customer_name);
      }
    });
    return Array.from(names).slice(0, 8);
  }, [bookings, filters.customerQuery]);

  const rawSelectedEvents = dayEvents.get(activeSelectedDate) ?? { bookings: [], blockouts: [] };
  const selectedEvents = {
    bookings: filters.showBookings ? rawSelectedEvents.bookings : [],
    blockouts: filters.showBlockouts ? rawSelectedEvents.blockouts : [],
  };
  const normalizedDayViewLimit =
    dayViewBookingLimit === "all"
      ? "all"
      : Number.isInteger(dayViewBookingLimit) && dayViewBookingLimit > 0
        ? dayViewBookingLimit
        : DEFAULT_DAY_BOOKING_LIMIT;
  const hasDayViewLimit = typeof normalizedDayViewLimit === "number";
  const now = new Date();
  const hasUpcomingInDayView = selectedEvents.bookings.some(
    (booking) => deriveBookingPhase(booking, now) === "UPCOMING",
  );

  const visibleDayBookings = showAllDayBookings
    ? selectedEvents.bookings
    : normalizedDayViewLimit === "all"
    ? selectedEvents.bookings
    : selectedEvents.bookings.slice(0, normalizedDayViewLimit);
  const hiddenDayBookingCount = Math.max(
    0,
    selectedEvents.bookings.length - visibleDayBookings.length,
  );
  const visibleDayBlockouts = showAllDayBlockouts
    ? selectedEvents.blockouts
    : normalizedDayViewLimit === "all"
    ? selectedEvents.blockouts
    : selectedEvents.blockouts.slice(0, normalizedDayViewLimit);
  const hiddenDayBlockoutCount = Math.max(
    0,
    selectedEvents.blockouts.length - visibleDayBlockouts.length,
  );

  const handlePrev = () => {
    const next = view === "month" ? addMonths(base, -1) : addDays(base, -7);
    setSelectedDate(formatDateKey(next));
    setShowAllDayBookings(false);
    setShowAllDayBlockouts(false);
    updateParams({ date: formatDateKey(next) });
  };

  const handleNext = () => {
    const next = view === "month" ? addMonths(base, 1) : addDays(base, 7);
    setSelectedDate(formatDateKey(next));
    setShowAllDayBookings(false);
    setShowAllDayBlockouts(false);
    updateParams({ date: formatDateKey(next) });
  };

  const handleToday = () => {
    const today = formatDateKey(new Date());
    setSelectedDate(today);
    setShowAllDayBookings(false);
    setShowAllDayBlockouts(false);
    updateParams({ date: today });
  };

  const openNewBlockout = () => {
    const day = activeSelectedDate || formatDateKey(new Date());
    const start = `${day}T08:00`;
    const end = `${day}T17:00`;
    setActiveBlockout({
      id: "",
      vehicle_id: filters.vehicleId ?? "",
      start_at: start,
      end_at: end,
      reason: "",
      notes: "",
      vehicle_make: "",
      vehicle_model: "",
    });
    setModalOpen(true);
  };

  const modalDraft = useMemo(() => {
    if (!activeBlockout) {
      return {
        id: "",
        vehicleId: filters.vehicleId ?? "",
        startAt: `${formatDateKey(new Date())}T08:00`,
        endAt: `${formatDateKey(new Date())}T17:00`,
        reason: "",
        notes: "",
      };
    }
    return {
      id: activeBlockout.id || undefined,
      vehicleId: activeBlockout.vehicle_id || filters.vehicleId || "",
      startAt: activeBlockout.start_at,
      endAt: activeBlockout.end_at,
      reason: activeBlockout.reason,
      notes: activeBlockout.notes ?? "",
    };
  }, [activeBlockout, filters.vehicleId]);

  const dayViewMoreButtonClass =
    "mt-2 cursor-pointer appearance-none border-0 bg-transparent text-xs font-semibold text-[var(--ccr-accent)] underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ccr-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ccr-surface)]";
  const countBadgeBaseClass =
    "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-semibold leading-none";
  const selectDay = (day: string) => {
    setSelectedDate(day);
    setShowAllDayBookings(false);
    setShowAllDayBlockouts(false);

    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    requestAnimationFrame(() => {
      dayViewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              className="rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Next
            </button>
            <span className="ml-2 text-sm font-semibold text-[var(--ccr-text)]">
              {base.toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={openNewBlockout}
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white"
          >
            + Add Blockout
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <div className="grid gap-3 md:grid-cols-[220px_1fr_1fr_1fr] md:items-end">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                View
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => updateParams({ view: "month" })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    view === "month"
                      ? "bg-[var(--ccr-primary)] text-white"
                      : "border border-[var(--ccr-border)] text-[var(--ccr-text)]"
                  }`}
                >
                  Month
                </button>
                <button
                  type="button"
                  onClick={() => updateParams({ view: "week" })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    view === "week"
                      ? "bg-[var(--ccr-primary)] text-white"
                      : "border border-[var(--ccr-border)] text-[var(--ccr-text)]"
                  }`}
                >
                  Week
                </button>
              </div>
            </div>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Vehicle
              <select
                value={filters.vehicleId ?? ""}
                onChange={(event) =>
                  updateParams({ vehicleId: event.target.value || null })
                }
                className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                <option value="">All vehicles</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.make} {vehicle.model}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Booking Status
              <select
                value={filters.status ?? "all"}
                onChange={(event) => {
                  const value = event.target.value;
                  updateParams({ status: value === "all" ? null : value });
                }}
                className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              >
                {CALENDAR_BOOKING_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Customer
              <input
                type="text"
                value={filters.customerQuery ?? ""}
                onChange={(event) =>
                  updateParams({
                    customerQ: event.target.value.trim() ? event.target.value : null,
                  })
                }
                list="calendar-customer-suggestions"
                placeholder="Type 3+ chars"
                className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
              <datalist id="calendar-customer-suggestions">
                {customerSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ccr-text)]">
              <input
                type="checkbox"
                checked={filters.showBookings}
                onChange={(event) =>
                  updateParams({ showBookings: event.target.checked ? null : "0" })
                }
                className="h-4 w-4 accent-[var(--ccr-accent)]"
              />
              Bookings
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ccr-text)]">
              <input
                type="checkbox"
                checked={filters.showBlockouts}
                onChange={(event) =>
                  updateParams({ showBlockouts: event.target.checked ? null : "0" })
                }
                className="h-4 w-4 accent-[var(--ccr-accent)]"
              />
              Blockouts
            </label>
          </div>
        </div>

        <div className="mt-6">
          <div
            className={
              view === "month"
                ? "mb-2 grid grid-cols-7 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]"
                : "mb-2 hidden text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:grid md:grid-cols-7"
            }
          >
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="px-1">
                {label}
              </span>
            ))}
          </div>
          <div
            className={`grid ${
              view === "month" ? "grid-cols-7 gap-1 sm:gap-1.5" : "grid-cols-1 gap-2 md:grid-cols-7"
            }`}
          >
          {days.map((day) => {
            const events = dayEvents.get(day) ?? { bookings: [], blockouts: [] };
            const bookingEvents = filters.showBookings ? events.bookings : [];
            const blockoutEvents = filters.showBlockouts ? events.blockouts : [];
            const monthMode = view === "month";
            const dayDate = new Date(`${day}T00:00:00`);
            const fullDayLabel = dayDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            const compactDayLabel = dayDate.toLocaleDateString(undefined, {
              day: "numeric",
            });
            return (
                <div
                  key={day}
                  onClick={() => selectDay(day)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    selectDay(day);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={activeSelectedDate === day}
                  className={`rounded-xl border border-[var(--ccr-border)] text-left transition ${
                    activeSelectedDate === day
                      ? "border-[var(--ccr-primary)] bg-[var(--ccr-surface-soft)] shadow-[inset_0_1px_2px_var(--ccr-border)] ring-1 ring-[var(--ccr-accent)]"
                      : ""
                  } ${
                    monthMode
                      ? "h-[54px] p-1 sm:h-[72px] sm:p-1.5"
                      : "min-h-[84px] p-2 sm:min-h-[96px]"
                  } cursor-pointer`}
                >
                <div
                  className={
                    monthMode
                      ? "flex h-full flex-col items-center justify-start gap-0.5 pt-0.5 text-center sm:gap-1"
                      : "flex items-start justify-between gap-1"
                  }
                >
                  <span className="text-xs font-semibold text-[var(--ccr-muted)]">
                    {monthMode ? (
                      <>
                        <span className="sm:hidden">{compactDayLabel}</span>
                        <span className="hidden sm:inline">{fullDayLabel}</span>
                      </>
                    ) : (
                      fullDayLabel
                    )}
                  </span>
                  <div
                    className={
                      monthMode ? "flex items-center justify-center gap-1" : "flex items-center gap-1"
                    }
                  >
                    {bookingEvents.length > 0 ? (
                      <span
                        className={`${countBadgeBaseClass} border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent)]`}
                        aria-label={`${bookingEvents.length} bookings`}
                        title={`${bookingEvents.length} bookings`}
                      >
                        {bookingEvents.length}
                      </span>
                    ) : null}
                    {blockoutEvents.length > 0 ? (
                      <span
                        className={`${countBadgeBaseClass} border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]`}
                        aria-label={`${blockoutEvents.length} blockouts`}
                        title={`${blockoutEvents.length} blockouts`}
                      >
                        {blockoutEvents.length}
                      </span>
                    ) : null}
                  </div>
                </div>
                {!monthMode ? (
                  <p className="mt-2 text-[10px] text-[var(--ccr-muted)]">Tap to view day details</p>
                ) : null}
              </div>
            );
          })}
          </div>
        </div>
      </div>

      <aside
        ref={dayViewRef}
        className="scroll-mt-20 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Day view
            </p>
            <h3 className="text-lg font-bold text-[var(--ccr-text)]">
              {new Date(`${activeSelectedDate}T00:00:00`).toLocaleDateString()}
            </h3>
          </div>
          <button
            type="button"
            onClick={openNewBlockout}
            className="rounded-lg border border-[var(--ccr-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Add Blockout
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Bookings
            </p>
            {selectedEvents.bookings.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">No bookings.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {visibleDayBookings.map((booking) => {
                  const phaseBadge = bookingPhaseBadge(deriveBookingPhase(booking, now));
                  return (
                    <li key={booking.id}>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="block rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent-strong)]"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span>
                            {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                          </span>
                          {phaseBadge ? (
                            <span className={phaseBadge.className}>
                              {phaseBadge.label}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {hiddenDayBookingCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllDayBookings(true)}
                className={dayViewMoreButtonClass}
              >
                See {hiddenDayBookingCount} more
              </button>
            ) : null}
            {showAllDayBookings && hasDayViewLimit && selectedEvents.bookings.length > normalizedDayViewLimit ? (
              <button
                type="button"
                onClick={() => setShowAllDayBookings(false)}
                className={dayViewMoreButtonClass}
              >
                See less
              </button>
            ) : null}
            {hasUpcomingInDayView ? (
              <Link
                href="/admin/bookings?scope=upcoming"
                className="mt-2 inline-flex text-xs font-semibold text-[var(--ccr-accent)] underline-offset-2 transition hover:underline"
              >
                See more upcoming
              </Link>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Blockouts
            </p>
            {selectedEvents.blockouts.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">No blockouts.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {visibleDayBlockouts.map((blockout) => (
                  <li key={blockout.id}>
                    <button
                      type="button"
                      onClick={() => {
                    setSelectedDate(activeSelectedDate);
                    setShowAllDayBookings(false);
                    setShowAllDayBlockouts(false);
                    setActiveBlockout(blockout);
                    setModalOpen(true);
                  }}
                      className="w-full rounded-xl border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] px-3 py-2 text-left text-xs font-semibold text-[var(--ccr-status-warning-text)]"
                    >
                      {blockout.reason} • {blockout.vehicle_make} {blockout.vehicle_model}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hiddenDayBlockoutCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllDayBlockouts(true)}
                className={dayViewMoreButtonClass}
              >
                See {hiddenDayBlockoutCount} more
              </button>
            ) : null}
            {showAllDayBlockouts && hasDayViewLimit && selectedEvents.blockouts.length > normalizedDayViewLimit ? (
              <button
                type="button"
                onClick={() => setShowAllDayBlockouts(false)}
                className={dayViewMoreButtonClass}
              >
                See less
              </button>
            ) : null}
          </div>
        </div>
      </aside>

      <BlockoutModal
        key={`${modalDraft.id ?? "new"}:${modalDraft.vehicleId}:${modalDraft.startAt}:${modalDraft.endAt}`}
        open={modalOpen}
        vehicles={vehicles}
        initial={modalDraft}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          router.refresh();
        }}
        onDeleted={() => {
          setModalOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
