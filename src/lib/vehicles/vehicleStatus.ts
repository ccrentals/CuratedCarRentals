import { isEntitledBooking } from "@/lib/availability/entitlementShared";
import { getStartOfToday as getUpcomingStartOfToday, getBookingStartAt } from "@/lib/bookings/upcoming";

const ACTIVE_RENTAL_STATUSES = new Set([
  "PICKED_UP",
  "ACTIVE",
  "IN_PROGRESS",
]);

const COMPLETED_STATUSES = new Set(["RETURNED", "COMPLETED"]);
const CANCELLED_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);
const LOST_STATUSES = new Set(["OVERRIDDEN", "LOST"]);
const ARCHIVED_STATUSES = new Set(["ARCHIVED"]);

export type DerivedBookingPhase =
  | "UPCOMING"
  | "PICKUP_OVERDUE"
  | "ON_RENT"
  | "COMPLETED"
  | "CANCELLED"
  | "LOST"
  | "ARCHIVED";

export type DerivedVehicleStatus =
  | "AVAILABLE"
  | "UPCOMING"
  | "ON_RENT"
  | "DIRTY"
  | "UNAVAILABLE";

export type VehicleStatusBookingLike = {
  id?: unknown;
  status?: unknown;
  archived_at?: unknown;
  archivedAt?: unknown;
  start_at?: unknown;
  startAt?: unknown;
  start_date?: unknown;
  startDate?: unknown;
  end_at?: unknown;
  endAt?: unknown;
  end_date?: unknown;
  endDate?: unknown;
  pricing_json?: unknown;
  pricingJson?: unknown;
  vehicle_deposit_cents?: unknown;
  vehicleDepositCents?: unknown;
};

export type VehicleStatusBlockoutLike = {
  start_at?: unknown;
  startAt?: unknown;
  end_at?: unknown;
  endAt?: unknown;
};

export type VehicleStatusContext = {
  bookings?: VehicleStatusBookingLike[];
  blockouts?: VehicleStatusBlockoutLike[];
  needsCleaning?: boolean | null;
  manualStatus?: unknown;
};

export type NextRelevantBookingWindow = {
  bookingId: string;
  phase: Extract<DerivedBookingPhase, "UPCOMING">;
  startAt: string;
  endAt: string;
};

function normalizeStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function parseDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnlyToUtcStart(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return parseDate(`${dateOnly}T00:00:00.000Z`);
}

function resolveBookingEndAt(booking: VehicleStatusBookingLike) {
  const direct = parseDate(booking.end_at ?? booking.endAt);
  if (direct) return direct;

  const endDateRaw = booking.end_date ?? booking.endDate;
  if (!endDateRaw) return null;

  const dateOnly = String(endDateRaw).trim();
  const dayStart = dateOnlyToUtcStart(dateOnly);
  if (!dayStart) return parseDate(endDateRaw);

  dayStart.setUTCDate(dayStart.getUTCDate() + 1);
  return dayStart;
}

function resolveBookingPricing(booking: VehicleStatusBookingLike) {
  const pricing = booking.pricing_json ?? booking.pricingJson;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return {};
  }
  return pricing as Record<string, unknown>;
}

function hasLostPricingSignal(pricing: Record<string, unknown>) {
  const entitlementStatus = normalizeStatus(pricing.entitlement_status);
  if (entitlementStatus === "LOST") return true;

  const cancelReason = normalizeStatus(pricing.cancel_reason);
  if (cancelReason === "LOST_TO_FIRST_DEPOSIT") return true;

  const overriddenByBookingId = String(pricing.overridden_by_booking_id ?? "").trim();
  return overriddenByBookingId.length > 0;
}

function bookingIsEntitledOrActive(booking: VehicleStatusBookingLike) {
  const pricing = resolveBookingPricing(booking);
  const entitled = isEntitledBooking(
    {
      status: booking.status,
      pricing_json: pricing,
      depositFallback: booking.vehicle_deposit_cents ?? booking.vehicleDepositCents,
    },
    pricing,
  );
  if (entitled) return true;
  return ACTIVE_RENTAL_STATUSES.has(normalizeStatus(booking.status));
}

function overlapsNow(startAt: Date | null, endAt: Date | null, now: Date) {
  if (!startAt || !endAt) return false;
  return startAt <= now && endAt > now;
}

function isArchivedBooking(booking: VehicleStatusBookingLike) {
  if (booking.archived_at || booking.archivedAt) return true;
  return ARCHIVED_STATUSES.has(normalizeStatus(booking.status));
}

export function getStartOfToday(now = new Date()) {
  return getUpcomingStartOfToday(now);
}

/**
 * Derives an operational booking phase for admin UIs.
 *
 * Rules:
 * - ARCHIVED/CANCELLED/LOST/COMPLETED are status-first terminal states.
 * - ON_RENT is any active-rental booking where pickup has actually been confirmed.
 * - PICKUP_OVERDUE is any pre-rental booking whose pickup time has passed without pickup confirmation.
 * - UPCOMING is any pre-rental booking whose pickup time is still in the future.
 * - If a booking is non-terminal but lacks a usable start bound, we conservatively map to COMPLETED.
 */
export function deriveBookingPhase(
  booking: VehicleStatusBookingLike,
  now = new Date(),
): DerivedBookingPhase {
  if (isArchivedBooking(booking)) return "ARCHIVED";

  const status = normalizeStatus(booking.status);
  const pricing = resolveBookingPricing(booking);

  if (LOST_STATUSES.has(status) || hasLostPricingSignal(pricing)) {
    return "LOST";
  }
  if (CANCELLED_STATUSES.has(status)) {
    return "CANCELLED";
  }
  if (COMPLETED_STATUSES.has(status)) {
    return "COMPLETED";
  }

  const startAt = getBookingStartAt(booking);
  const endAt = resolveBookingEndAt(booking);
  const isActiveRentalStatus = ACTIVE_RENTAL_STATUSES.has(status);

  if (isActiveRentalStatus && overlapsNow(startAt, endAt, now)) {
    return "ON_RENT";
  }

  if (startAt && startAt > now) {
    return "UPCOMING";
  }

  if (startAt && startAt <= now && !isActiveRentalStatus) {
    return "PICKUP_OVERDUE";
  }

  return "COMPLETED";
}

export function derivedBookingPhaseLabel(phase: DerivedBookingPhase) {
  if (phase === "UPCOMING") return "Upcoming";
  if (phase === "PICKUP_OVERDUE") return "Pickup overdue";
  if (phase === "ON_RENT") return "On Rent";
  if (phase === "CANCELLED") return "Cancelled";
  if (phase === "LOST") return "Lost";
  if (phase === "ARCHIVED") return "Archived";
  return "Completed";
}

/**
 * Derives fleet status using the same booking-phase and entitlement logic everywhere.
 *
 * Precedence order:
 * 1) ON_RENT: an active-window booking that is entitled or operationally active.
 * 2) DIRTY: profile needs_cleaning=true (or legacy MAINTENANCE manual status).
 * 3) UNAVAILABLE: currently blocked by blockout or manually unavailable/inactive.
 * 4) UPCOMING: at least one future or overdue pre-rental booking.
 * 5) AVAILABLE: none of the above.
 *
 * Decision note: UPCOMING includes both future and overdue pre-rental bookings
 * so vehicles do not become available just because pickup time passed without confirmation.
 */
export function deriveVehicleStatus(
  vehicle: { status?: unknown } | null | undefined,
  now = new Date(),
  context: VehicleStatusContext = {},
): DerivedVehicleStatus {
  const manualStatus = normalizeStatus(context.manualStatus ?? vehicle?.status);
  const bookings = Array.isArray(context.bookings) ? context.bookings : [];
  const blockouts = Array.isArray(context.blockouts) ? context.blockouts : [];

  const hasActiveRental = bookings.some((booking) => {
    const phase = deriveBookingPhase(booking, now);
    if (phase !== "ON_RENT") return false;
    return bookingIsEntitledOrActive(booking);
  });
  if (hasActiveRental) return "ON_RENT";

  if (context.needsCleaning === true || manualStatus === "MAINTENANCE") {
    return "DIRTY";
  }

  const blockedNow = blockouts.some((blockout) => {
    const startAt = parseDate(blockout.start_at ?? blockout.startAt);
    const endAt = parseDate(blockout.end_at ?? blockout.endAt);
    return overlapsNow(startAt, endAt, now);
  });
  if (blockedNow || manualStatus === "INACTIVE" || manualStatus === "UNAVAILABLE") {
    return "UNAVAILABLE";
  }

  const hasUpcoming = bookings.some((booking) => {
    const phase = deriveBookingPhase(booking, now);
    return phase === "UPCOMING" || phase === "PICKUP_OVERDUE";
  });
  if (hasUpcoming) {
    return "UPCOMING";
  }

  return "AVAILABLE";
}

export function nextRelevantBookingWindowFromBookings(
  bookings: VehicleStatusBookingLike[],
  now = new Date(),
): NextRelevantBookingWindow | null {
  const candidates = bookings
    .map((booking) => {
      const phase = deriveBookingPhase(booking, now);
      if (phase !== "UPCOMING") return null;
      const startAt = getBookingStartAt(booking);
      const endAt = resolveBookingEndAt(booking);
      if (!startAt || !endAt) return null;

      const bookingId = String(booking.id ?? "").trim();
      if (!bookingId) return null;

      return {
        bookingId,
        phase,
        startAt,
        endAt,
      };
    })
    .filter((item): item is { bookingId: string; phase: "UPCOMING"; startAt: Date; endAt: Date } => Boolean(item))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const next = candidates[0];
  if (!next) return null;

  return {
    bookingId: next.bookingId,
    phase: "UPCOMING",
    startAt: next.startAt.toISOString(),
    endAt: next.endAt.toISOString(),
  };
}

export function derivedVehicleStatusLabel(status: DerivedVehicleStatus) {
  if (status === "ON_RENT") return "On Rent";
  if (status === "UPCOMING") return "Upcoming";
  if (status === "DIRTY") return "Dirty";
  if (status === "UNAVAILABLE") return "Unavailable";
  return "Available";
}
