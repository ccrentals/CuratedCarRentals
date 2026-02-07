"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BlockoutModal } from "@/components/admin/BlockoutModal";

type VehicleOption = {
  id: string;
  make: string;
  model: string;
};

type BookingEvent = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
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
  filters: {
    vehicleId?: string;
    showBookings: boolean;
    showBlockouts: boolean;
    status?: string;
  };
};

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
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

export function CalendarView({
  view,
  baseDate,
  days,
  bookings,
  blockouts,
  vehicles,
  filters,
}: CalendarViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<string>(baseDate);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeBlockout, setActiveBlockout] = useState<BlockoutEvent | null>(null);

  const base = parseDateKey(baseDate) ?? new Date();

  useEffect(() => {
    if (!days.includes(selectedDate)) {
      setSelectedDate(baseDate);
    }
  }, [baseDate, days, selectedDate]);

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

    bookings.forEach((booking) => {
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
  }, [bookings, blockouts, days]);

  const rawSelectedEvents = dayEvents.get(selectedDate) ?? { bookings: [], blockouts: [] };
  const selectedEvents = {
    bookings: filters.showBookings ? rawSelectedEvents.bookings : [],
    blockouts: filters.showBlockouts ? rawSelectedEvents.blockouts : [],
  };

  const handlePrev = () => {
    const next = view === "month" ? addMonths(base, -1) : addDays(base, -7);
    updateParams({ date: formatDateKey(next) });
  };

  const handleNext = () => {
    const next = view === "month" ? addMonths(base, 1) : addDays(base, 7);
    updateParams({ date: formatDateKey(next) });
  };

  const handleToday = () => {
    updateParams({ date: formatDateKey(new Date()) });
  };

  const openNewBlockout = () => {
    const day = selectedDate || formatDateKey(new Date());
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

  const statusOptions = [
    { label: "All", value: "all" },
    { label: "Pending", value: "pending_payment" },
    { label: "Confirmed", value: "confirmed" },
    { label: "Returned", value: "returned" },
    { label: "Cancelled", value: "cancelled" },
  ];

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

        <div className="mt-4 flex flex-wrap gap-3 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
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
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ccr-text)]">
              <input
                type="checkbox"
                checked={filters.showBookings}
                onChange={(event) =>
                  updateParams({ showBookings: event.target.checked ? null : "0" })
                }
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
              />
              Blockouts
            </label>
          </div>
        </div>

        <div
          className={`mt-6 grid gap-2 ${
            view === "month" ? "grid-cols-7" : "grid-cols-1 md:grid-cols-7"
          }`}
        >
          {days.map((day) => {
            const events = dayEvents.get(day) ?? { bookings: [], blockouts: [] };
            const bookingEvents = filters.showBookings ? events.bookings : [];
            const blockoutEvents = filters.showBlockouts ? events.blockouts : [];
            const total = bookingEvents.length + blockoutEvents.length;
            const topEvents = [...bookingEvents, ...blockoutEvents].slice(0, 2);
            return (
              <button
                type="button"
                key={day}
                onClick={() => setSelectedDate(day)}
                className={`min-h-[120px] rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-2 text-left transition ${
                  selectedDate === day ? "border-[var(--ccr-primary)] shadow-sm" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--ccr-muted)]">
                    {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="text-[11px] text-[var(--ccr-muted)]">{total}</span>
                </div>
                <div className="mt-1 text-[10px] text-[var(--ccr-muted)]">
                  {filters.showBookings ? `Bookings: ${bookingEvents.length}` : null}
                  {filters.showBookings && filters.showBlockouts ? " · " : ""}
                  {filters.showBlockouts ? `Blockouts: ${blockoutEvents.length}` : null}
                </div>
                <div className="mt-2 space-y-1">
                  {topEvents.map((event, index) => {
                    const isBooking = "customer_name" in event;
                    const label = isBooking
                      ? `${(event as BookingEvent).vehicle_make} ${(event as BookingEvent).vehicle_model}`
                      : (event as BlockoutEvent).reason;
                    return (
                      <div
                        key={`${day}-${index}-${label}`}
                        className={`truncate rounded-md px-2 py-1 text-[10px] font-semibold ${
                          isBooking
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {isBooking ? "Booking" : "Blockout"} • {label}
                      </div>
                    );
                  })}
                  {total > 2 ? (
                    <p className="text-[10px] text-[var(--ccr-muted)]">+{total - 2} more</p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Day view
            </p>
            <h3 className="text-lg font-bold text-[var(--ccr-primary)]">
              {new Date(`${selectedDate}T00:00:00`).toLocaleDateString()}
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
                {selectedEvents.bookings.map((booking) => (
                  <li key={booking.id}>
                    <Link
                      href={`/admin/bookings/${booking.id}`}
                      className="block rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"
                    >
                      {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Blockouts
            </p>
            {selectedEvents.blockouts.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">No blockouts.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {selectedEvents.blockouts.map((blockout) => (
                  <li key={blockout.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveBlockout(blockout);
                        setModalOpen(true);
                      }}
                      className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800"
                    >
                      {blockout.reason} • {blockout.vehicle_make} {blockout.vehicle_model}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>

      <BlockoutModal
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
