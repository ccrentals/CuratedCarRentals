import { CalendarView } from "@/components/admin/CalendarView";
import { CopySqlButton } from "@/components/admin/CopySqlButton";
import { loadAdminSettings } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";

type VehicleRow = {
  id: string;
  make: string;
  model: string;
};

type BookingRow = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  customer_name: string;
  vehicle_id: string;
  vehicle_make: string;
  vehicle_model: string;
};

type BlockoutRow = {
  id: string;
  vehicle_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes: string | null;
  vehicle_make: string;
  vehicle_model: string;
};

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (6 - day));
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function startOfMonth(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfMonth(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function formatDateKey(date: Date) {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildDays(rangeStart: Date, rangeEnd: Date) {
  const days: string[] = [];
  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    days.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const blockoutsSchemaSql = `create table if not exists blockouts (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blockouts_vehicle_id_idx on blockouts(vehicle_id);
create index if not exists blockouts_range_idx on blockouts(start_at, end_at);`;

  const params = await searchParams;
  const view = params.view === "week" ? "week" : "month";
  const baseDate = parseDate(typeof params.date === "string" ? params.date : undefined) ?? new Date();
  const vehicleId = typeof params.vehicleId === "string" ? params.vehicleId : undefined;
  const showBookings = params.showBookings !== "0";
  const showBlockouts = params.showBlockouts !== "0";
  const statusParam = typeof params.status === "string" ? params.status.toLowerCase() : undefined;

  const rangeStart =
    view === "month" ? startOfWeek(startOfMonth(baseDate)) : startOfWeek(baseDate);
  const rangeEnd = view === "month" ? endOfWeek(endOfMonth(baseDate)) : endOfWeek(baseDate);

  const days = buildDays(rangeStart, rangeEnd);
  const startDate = formatDateKey(rangeStart);
  const endDate = formatDateKey(rangeEnd);

  const vehicles = await dbQuery<VehicleRow>("select id, make, model from vehicles order by make, model");
  const { settings: adminSettings } = await loadAdminSettings();

  let statusFilter: string | undefined;
  if (statusParam && statusParam !== "all") {
    const map: Record<string, string> = {
      pending_payment: "PENDING_PAYMENT",
      pending: "PENDING_PAYMENT",
      confirmed: "CONFIRMED",
      returned: "RETURNED",
      cancelled: "CANCELLED",
    };
    statusFilter = map[statusParam] ?? statusParam.toUpperCase();
  }

  const bookingClauses: string[] = ["b.start_date <= $2", "b.end_date >= $1"];
  const bookingValues: Array<string> = [startDate, endDate];
  let bookingParamIndex = 3;

  if (vehicleId) {
    bookingClauses.push(`b.vehicle_id = $${bookingParamIndex}`);
    bookingValues.push(vehicleId);
    bookingParamIndex += 1;
  }

  if (statusFilter) {
    bookingClauses.push(`b.status = $${bookingParamIndex}`);
    bookingValues.push(statusFilter);
    bookingParamIndex += 1;
  }

  const bookings = showBookings
    ? await dbQuery<BookingRow>(
        "select b.id, b.status, b.start_date, b.end_date, b.pickup_location, c.full_name as customer_name, v.id as vehicle_id, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where " +
          bookingClauses.join(" and ") +
          " order by b.start_date asc",
        bookingValues,
      )
    : { rows: [] };

  const blockoutClauses: string[] = ["b.start_at < $2", "b.end_at > $1"];
  const blockoutValues: string[] = [rangeStart.toISOString(), rangeEnd.toISOString()];
  let blockoutParamIndex = 3;

  if (vehicleId) {
    blockoutClauses.push(`b.vehicle_id = $${blockoutParamIndex}`);
    blockoutValues.push(vehicleId);
  }

  let blockoutsTableMissing = false;
  let blockouts: { rows: BlockoutRow[] } = { rows: [] };

  if (showBlockouts) {
    try {
      blockouts = await dbQuery<BlockoutRow>(
        "select b.id, b.vehicle_id, b.start_at, b.end_at, b.reason, b.notes, v.make as vehicle_make, v.model as vehicle_model from blockouts b join vehicles v on v.id = b.vehicle_id where " +
          blockoutClauses.join(" and ") +
          " order by b.start_at asc",
        blockoutValues,
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code === "42P01") {
        blockoutsTableMissing = true;
        blockouts = { rows: [] };
      } else {
        throw error;
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Calendar</h1>
      </div>

      {blockoutsTableMissing ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Blockouts not configured</p>
          <p className="mt-1">
            The ‘blockouts’ table is missing in the connected database. Apply the blockouts table
            section from schema.sql to enable maintenance/unavailable scheduling.
          </p>
          <details className="mt-3 rounded-xl border border-amber-200 bg-white/60 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-amber-900">
              Show SQL to create blockouts table
            </summary>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-amber-900">Run this in the Neon SQL Editor.</p>
              <CopySqlButton text={blockoutsSchemaSql} />
            </div>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-xs text-amber-900">
{blockoutsSchemaSql}
            </pre>
          </details>
        </div>
      ) : null}

      <CalendarView
        view={view}
        baseDate={formatDateKey(baseDate)}
        days={days}
        bookings={bookings.rows}
        blockouts={blockouts.rows}
        vehicles={vehicles.rows}
        dayViewBookingLimit={adminSettings.dayViewBookingLimit}
        filters={{
          vehicleId,
          showBookings,
          showBlockouts,
          status: statusParam ?? "all",
        }}
      />
    </div>
  );
}
