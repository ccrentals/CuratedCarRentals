import { writeAuditLog } from "@/lib/audit";
import { dbQuery, getDbPool } from "@/lib/db";
import { readAmountPaid, type Queryable } from "@/lib/payments/pricing";
import { recalculateBookingPayments, type BookingPaymentSummary } from "@/lib/payments/recalculateBooking";
import { isEntitledBooking as isEntitledBookingShared } from "@/lib/availability/entitlementShared";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = "^-?[0-9]+(\\.[0-9]+)?$";

const PRICING_AMOUNT_PAID_SQL = `coalesce(
  case
    when coalesce(b.pricing_json->>'amount_paid', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'amount_paid')::numeric
    else null
  end,
  case
    when coalesce(b.pricing_json->>'paid_to_date', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'paid_to_date')::numeric
    else null
  end,
  0
)`;

const HAS_PAYMENT_ROWS_SQL = `exists(
  select 1
  from payments p
  where p.booking_id = b.id
    and p.status in ('DEPOSIT_PAID', 'REFUNDED')
)`;

const PAYMENT_LEDGER_AMOUNT_PAID_SQL = `(
  select coalesce(sum(p.deposit_amount_cents), 0)
  from payments p
  where p.booking_id = b.id
    and p.status in ('DEPOSIT_PAID', 'REFUNDED')
)`;

const AMOUNT_PAID_SQL = `(case when ${HAS_PAYMENT_ROWS_SQL} then ${PAYMENT_LEDGER_AMOUNT_PAID_SQL} else ${PRICING_AMOUNT_PAID_SQL} end)`;

const DEPOSIT_REQUIRED_SQL = `coalesce(
  case
    when coalesce(b.pricing_json->>'deposit_required_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'deposit_required_cents')::numeric
    else null
  end,
  case
    when coalesce(b.pricing_json->>'deposit_cents', '') ~ '${NUMERIC_PATTERN}' then (b.pricing_json->>'deposit_cents')::numeric
    else null
  end,
  v.deposit_cents::numeric,
  0
)`;

const PAYMENT_STATUS_SQL = `upper(coalesce(b.pricing_json->>'payment_status', 'UNPAID'))`;
const ACTIVE_BOOKING_SQL = "upper(coalesce(b.status, '')) not in ('CANCELLED', 'RETURNED', 'OVERRIDDEN')";
const ENTITLED_SQL = `(${PAYMENT_STATUS_SQL} = 'PAID_IN_FULL' or ${AMOUNT_PAID_SQL} >= ${DEPOSIT_REQUIRED_SQL})`;
const TENTATIVE_SQL = `(not ${ENTITLED_SQL})`;
const ENTITLED_AT_SQL = `(
  case
    when coalesce(b.pricing_json->>'entitled_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T' then (b.pricing_json->>'entitled_at')::timestamptz
    else null
  end
)`;
const ENTITLED_AT_FROM_PAYMENTS_SQL = `(
  select candidate.created_at
  from (
    select p.id, p.created_at, sum(p.deposit_amount_cents) over (order by p.created_at asc, p.id asc) as running_paid_cents
    from payments p
    where p.booking_id = b.id
      and p.status in ('DEPOSIT_PAID', 'REFUNDED')
  ) as candidate
  where candidate.running_paid_cents >= ${DEPOSIT_REQUIRED_SQL}
  order by candidate.created_at asc, candidate.id asc
  limit 1
)`;
const ENTITLEMENT_SORT_SQL = `coalesce(${ENTITLED_AT_SQL}, ${ENTITLED_AT_FROM_PAYMENTS_SQL}, b.created_at)`;

type MaybeRecord = Record<string, unknown> | null | undefined;

export type OverlapWindowInput = {
  startAt: string | Date;
  endAt: string | Date;
};

export type EntitledOverlapBooking = {
  id: string;
  status: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  startAt: string;
  endAt: string;
  amountPaid: number;
  depositRequired: number;
  entitlementSortAt: string | null;
};

export type CancelledTentativeBooking = {
  id: string;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
};

export type EntitlementResolution =
  | {
      bookingId: string;
      state: "TENTATIVE";
      status: string;
      depositRequired: number;
      paidToDate: number;
      cancelledOverlaps: [];
      winnerBookingId: null;
    }
  | {
      bookingId: string;
      state: "ENTITLED";
      status: string;
      depositRequired: number;
      paidToDate: number;
      cancelledOverlaps: CancelledTentativeBooking[];
      winnerBookingId: string;
    }
  | {
      bookingId: string;
      state: "LOST";
      status: string;
      depositRequired: number;
      paidToDate: number;
      cancelledOverlaps: [];
      winnerBookingId: string;
    };

type BookingWindowRow = {
  id: string;
  status: string;
  vehicle_id: string;
  start_date: string | Date;
  end_date: string | Date;
  start_at: string | Date | null;
  end_at: string | Date | null;
  pricing_json: Record<string, unknown> | null;
};

type RecalculateBookingFn = (
  bookingId: string,
  options?: { client?: Queryable },
) => Promise<BookingPaymentSummary>;

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value instanceof Date) return value.toISOString();
  return "";
}

function toIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function normalizeWindow(window: OverlapWindowInput) {
  const startAt = toIso(window.startAt);
  const endAt = toIso(window.endAt);
  if (!startAt || !endAt) return null;
  if (new Date(endAt) <= new Date(startAt)) return null;
  return { startAt, endAt };
}

function normalizeBookingDate(value: unknown, fallbackTime: "start" | "end") {
  const dateOnly =
    value instanceof Date && Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10)
      : toText(value);
  if (!dateOnly) return null;
  if (fallbackTime === "start") {
    return toIso(`${dateOnly}T00:00:00.000Z`);
  }

  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function resolveBookingWindow(booking: BookingWindowRow) {
  const startAt =
    toIso(booking.start_at) ?? normalizeBookingDate(booking.start_date, "start");
  const endAt = toIso(booking.end_at) ?? normalizeBookingDate(booking.end_date, "end");
  if (!startAt || !endAt) return null;
  if (new Date(endAt) <= new Date(startAt)) return null;
  return { startAt, endAt };
}

function isClosedStatus(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return normalized === "CANCELLED" || normalized === "RETURNED" || normalized === "OVERRIDDEN";
}

export function isEntitledBooking(
  booking: {
    status?: unknown;
    pricing_json?: MaybeRecord;
    paymentStatus?: unknown;
    paidToDate?: unknown;
    depositRequired?: unknown;
    depositFallback?: unknown;
  },
  pricingSnapshot?: MaybeRecord,
): boolean {
  return isEntitledBookingShared(booking, pricingSnapshot);
}

async function hasOverlappingBlockout(
  vehicleId: string,
  window: OverlapWindowInput,
  db: Queryable,
) {
  const normalized = normalizeWindow(window);
  if (!normalized || !UUID_REGEX.test(vehicleId)) return true;

  const result = await db.query(
    "select bo.id from blockouts bo where bo.vehicle_id = $1 and bo.start_at < $3::timestamptz and bo.end_at > $2::timestamptz limit 1",
    [vehicleId, normalized.startAt, normalized.endAt],
  );
  return result.rowCount > 0;
}

export async function findOverlappingEntitledBooking(
  vehicleId: string,
  startAt: string | Date,
  endAt: string | Date,
  db: Queryable,
  options: { excludeBookingId?: string | null; forUpdate?: boolean } = {},
): Promise<EntitledOverlapBooking | null> {
  if (!UUID_REGEX.test(vehicleId)) return null;
  const normalized = normalizeWindow({ startAt, endAt });
  if (!normalized) return null;

  const result = await db.query(
    "select b.id, b.status, b.vehicle_id, b.start_date, b.end_date, coalesce(b.start_at, b.start_date::timestamptz) as start_at, coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) as end_at, " +
      `${AMOUNT_PAID_SQL} as amount_paid, ${DEPOSIT_REQUIRED_SQL} as deposit_required, ${ENTITLEMENT_SORT_SQL} as entitlement_sort_at, b.created_at as booking_created_at ` +
      "from bookings b join vehicles v on v.id = b.vehicle_id " +
      "where b.vehicle_id = $1 and " +
      ACTIVE_BOOKING_SQL +
      " and coalesce(b.start_at, b.start_date::timestamptz) < $3::timestamptz and coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) > $2::timestamptz " +
      "and ($4::uuid is null or b.id <> $4::uuid) and " +
      ENTITLED_SQL +
      " order by entitlement_sort_at asc, booking_created_at asc, b.id asc limit 1" +
      (options.forUpdate ? " for update" : ""),
    [vehicleId, normalized.startAt, normalized.endAt, options.excludeBookingId ?? null],
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0] as {
    id: string;
    status: string;
    vehicle_id: string;
    start_date: string | Date;
    end_date: string | Date;
    start_at: string | Date;
    end_at: string | Date;
    amount_paid: number;
    deposit_required: number;
    entitlement_sort_at: string | Date | null;
  };

  return {
    id: row.id,
    status: row.status,
    vehicleId: row.vehicle_id,
    startDate: toText(row.start_date),
    endDate: toText(row.end_date),
    startAt: toText(row.start_at),
    endAt: toText(row.end_at),
    amountPaid: toNumber(row.amount_paid),
    depositRequired: Math.max(0, toNumber(row.deposit_required)),
    entitlementSortAt: toIso(row.entitlement_sort_at),
  };
}

async function findBlockedVehicleIdsForWindow(
  vehicleIds: string[],
  window: OverlapWindowInput,
  db: Queryable,
  options: { includeBlockouts?: boolean } = {},
) {
  const ids = vehicleIds.filter((id) => UUID_REGEX.test(id));
  if (ids.length === 0) return new Set<string>();
  const normalized = normalizeWindow(window);
  if (!normalized) return new Set(ids);
  const includeBlockouts = options.includeBlockouts !== false;

  const blockoutsUnion = includeBlockouts
    ? " union select bo.vehicle_id from blockouts bo where bo.vehicle_id = any($1::uuid[]) and bo.start_at < $3::timestamptz and bo.end_at > $2::timestamptz"
    : "";

  const result = await db.query(
    "select distinct blocked.vehicle_id from (" +
      "select b.vehicle_id from bookings b join vehicles v on v.id = b.vehicle_id where b.vehicle_id = any($1::uuid[]) and " +
      ACTIVE_BOOKING_SQL +
      " and coalesce(b.start_at, b.start_date::timestamptz) < $3::timestamptz and coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) > $2::timestamptz and " +
      ENTITLED_SQL +
      blockoutsUnion +
      ") as blocked",
    [ids, normalized.startAt, normalized.endAt],
  );

  return new Set(
    result.rows
      .map((row) => toText((row as { vehicle_id?: unknown }).vehicle_id))
      .filter((value) => value.length > 0),
  );
}

export async function listAvailableVehiclesEntitlementBased<T extends { id: string }>(
  vehicles: T[],
  window: OverlapWindowInput,
  options: { client?: Queryable; includeBlockouts?: boolean } = {},
): Promise<T[]> {
  if (vehicles.length === 0) return [];
  const db = options.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };
  const blockedIds = await findBlockedVehicleIdsForWindow(
    vehicles.map((vehicle) => vehicle.id),
    window,
    db,
    { includeBlockouts: options.includeBlockouts },
  );
  return vehicles.filter((vehicle) => !blockedIds.has(vehicle.id));
}

export async function isVehicleUnavailableEntitlementBased(
  vehicleId: string,
  window: OverlapWindowInput,
  options: { client?: Queryable; includeBlockouts?: boolean; excludeBookingId?: string | null } = {},
): Promise<boolean> {
  const db = options.client ?? {
    query: (text: string, params: unknown[] = []) => dbQuery(text, params),
  };

  const entitled = await findOverlappingEntitledBooking(
    vehicleId,
    window.startAt,
    window.endAt,
    db,
    { excludeBookingId: options.excludeBookingId ?? null },
  );
  if (entitled) return true;
  if (options.includeBlockouts === false) return false;
  return hasOverlappingBlockout(vehicleId, window, db);
}

function buildLostPricingSnapshot(input: {
  existingPricing: MaybeRecord;
  winnerBookingId: string;
  reason: string;
  nowIso: string;
  paidToDate: number;
  depositRequired: number;
}) {
  const existing = toObject(input.existingPricing);
  return {
    ...existing,
    payment_status: String(existing.payment_status ?? "").trim().toUpperCase() || "UNPAID",
    amount_paid: input.paidToDate,
    paid_to_date: input.paidToDate,
    deposit_required_cents: input.depositRequired,
    overridden_by_booking_id: input.winnerBookingId,
    overridden_at: input.nowIso,
    override_reason: input.reason,
    cancelled_at: input.nowIso,
    cancel_reason: "LOST_TO_FIRST_DEPOSIT",
    entitlement_status: "LOST",
    entitlement_lost_at: input.nowIso,
    entitlement_lost_to_booking_id: input.winnerBookingId,
    lost_email_sent_at: null,
    lost_email_sent_by_booking_id: null,
    refund_review_required: input.paidToDate > 0,
  };
}

function buildEntitledPricingSnapshot(input: {
  existingPricing: MaybeRecord;
  nowIso: string;
  paidToDate: number;
  depositRequired: number;
}) {
  const existing = toObject(input.existingPricing);
  return {
    ...existing,
    amount_paid: input.paidToDate,
    paid_to_date: input.paidToDate,
    deposit_required_cents: input.depositRequired,
    entitlement_status: "ENTITLED",
    entitled_at: input.nowIso,
    entitled_deposit_required_cents: input.depositRequired,
    entitled_paid_to_date_cents: input.paidToDate,
    entitlement_lost_at: null,
    entitlement_lost_to_booking_id: null,
    refund_review_required: Boolean(existing.refund_review_required ?? false),
  };
}

export async function cancelOverlappingTentativeBookings(
  winnerBookingId: string,
  vehicleId: string,
  startAt: string | Date,
  endAt: string | Date,
  db: Queryable,
): Promise<CancelledTentativeBooking[]> {
  const normalized = normalizeWindow({ startAt, endAt });
  if (!normalized || !UUID_REGEX.test(vehicleId)) return [];

  const rowsResult = await db.query(
    "select b.id, b.status, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, " +
      `${AMOUNT_PAID_SQL} as amount_paid, ${DEPOSIT_REQUIRED_SQL} as deposit_required ` +
      "from bookings b " +
      "join customers c on c.id = b.customer_id " +
      "join vehicles v on v.id = b.vehicle_id " +
      "where b.vehicle_id = $1 and " +
      ACTIVE_BOOKING_SQL +
      " and b.id <> $4::uuid and coalesce(b.start_at, b.start_date::timestamptz) < $3::timestamptz and coalesce(b.end_at, (b.end_date::timestamptz + interval '1 day')) > $2::timestamptz and " +
      TENTATIVE_SQL +
      " for update",
    [vehicleId, normalized.startAt, normalized.endAt, winnerBookingId],
  );

  if (rowsResult.rowCount === 0) return [];
  const nowIso = new Date().toISOString();
  const cancelled: CancelledTentativeBooking[] = [];

  for (const row of rowsResult.rows as Array<{
    id: string;
    status: string;
    start_date: string | Date;
    end_date: string | Date;
    pickup_location: string;
    pricing_json: Record<string, unknown> | null;
    customer_name: string;
    customer_email: string;
    vehicle_make: string;
    vehicle_model: string;
    amount_paid: number;
    deposit_required: number;
  }>) {
    const paidToDate = toNumber(row.amount_paid);
    const depositRequired = Math.max(0, toNumber(row.deposit_required));
    const updatedPricing = buildLostPricingSnapshot({
      existingPricing: row.pricing_json,
      winnerBookingId,
      reason: "LOST_TO_FIRST_DEPOSIT",
      nowIso,
      paidToDate,
      depositRequired,
    });

    await db.query(
      "update bookings set status = 'CANCELLED', pricing_json = $2, updated_at = now() where id = $1 and upper(coalesce(status, '')) not in ('CANCELLED', 'RETURNED', 'OVERRIDDEN')",
      [row.id, updatedPricing],
    );

    cancelled.push({
      id: row.id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
      startDate: toText(row.start_date),
      endDate: toText(row.end_date),
      pickupLocation: row.pickup_location,
    });
  }

  return cancelled;
}

export async function maybeEntitleBookingAfterPayment(
  bookingId: string,
  options: {
    client?: Queryable;
    recalculateBooking?: RecalculateBookingFn;
    auditUserId?: string;
  } = {},
): Promise<EntitlementResolution> {
  const ownsClient = !options.client;
  const pool = ownsClient ? getDbPool() : null;
  const client = options.client ?? (await pool!.connect());
  const recalculate = options.recalculateBooking ?? recalculateBookingPayments;

  try {
    if (ownsClient) {
      await client.query("begin");
    }

    const bookingResult = await client.query(
      "select b.id, b.status, b.vehicle_id, b.start_date, b.end_date, b.start_at, b.end_at, b.pricing_json from bookings b where b.id = $1 for update",
      [bookingId],
    );

    if (bookingResult.rowCount === 0) {
      throw new Error("Booking not found");
    }

    const booking = bookingResult.rows[0] as BookingWindowRow;
    const window = resolveBookingWindow(booking);
    if (!window) {
      throw new Error("Invalid booking window");
    }

    const summary = await recalculate(booking.id, { client });
    const paidToDate = Math.max(0, toNumber(summary.netPaidToDate));
    const depositRequired = Math.max(0, toNumber(summary.depositAmount));
    const thresholdReached =
      summary.paymentStatus === "PAID_IN_FULL" || paidToDate >= depositRequired;

    if (!thresholdReached || isClosedStatus(booking.status)) {
      if (ownsClient) {
        await client.query("commit");
      }
      return {
        bookingId: booking.id,
        state: "TENTATIVE",
        status: String(booking.status ?? ""),
        paidToDate,
        depositRequired,
        cancelledOverlaps: [],
        winnerBookingId: null,
      };
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [booking.vehicle_id]);

    const winner = await findOverlappingEntitledBooking(
      booking.vehicle_id,
      window.startAt,
      window.endAt,
      client,
      { excludeBookingId: null, forUpdate: true },
    );

    if (winner && winner.id !== booking.id) {
      const currentPricing = toObject((await client.query(
        "select pricing_json from bookings where id = $1 for update",
        [booking.id],
      )).rows[0]?.pricing_json);
      const nowIso = new Date().toISOString();
      const updatedPricing = buildLostPricingSnapshot({
        existingPricing: currentPricing,
        winnerBookingId: winner.id,
        reason: "LOST_TO_FIRST_DEPOSIT",
        nowIso,
        paidToDate,
        depositRequired,
      });

      await client.query(
        "update bookings set status = 'CANCELLED', pricing_json = $2, updated_at = now() where id = $1",
        [booking.id, updatedPricing],
      );

      if (options.auditUserId) {
        await writeAuditLog({
          userId: options.auditUserId,
          action: "BOOKING_ENTITLEMENT_LOST_AFTER_PAYMENT",
          entityType: "booking",
          entityId: booking.id,
          details: {
            winnerBookingId: winner.id,
            paidToDate,
            depositRequired,
            reason: "LOST_TO_FIRST_DEPOSIT",
          },
        });
      }

      if (ownsClient) {
        await client.query("commit");
      }
      return {
        bookingId: booking.id,
        state: "LOST",
        status: "CANCELLED",
        paidToDate,
        depositRequired,
        cancelledOverlaps: [],
        winnerBookingId: winner.id,
      };
    }

    const shouldConfirm = String(booking.status ?? "")
      .trim()
      .toUpperCase() === "PENDING_PAYMENT" || String(booking.status ?? "")
      .trim()
      .toUpperCase() === "PENDING";
    if (shouldConfirm) {
      await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
        booking.id,
      ]);
    }

    const cancelledOverlaps = await cancelOverlappingTentativeBookings(
      booking.id,
      booking.vehicle_id,
      window.startAt,
      window.endAt,
      client,
    );

    const latestPricing = toObject(
      (await client.query("select pricing_json from bookings where id = $1 for update", [booking.id]))
        .rows[0]?.pricing_json,
    );
    const nowIso = new Date().toISOString();
    const entitledPricing = buildEntitledPricingSnapshot({
      existingPricing: latestPricing,
      nowIso,
      paidToDate,
      depositRequired,
    });
    await client.query("update bookings set pricing_json = $2, updated_at = now() where id = $1", [
      booking.id,
      entitledPricing,
    ]);

    if (options.auditUserId) {
      await writeAuditLog({
        userId: options.auditUserId,
        action: "BOOKING_ENTITLED_BY_DEPOSIT",
        entityType: "booking",
        entityId: booking.id,
        details: {
          paidToDate,
          depositRequired,
          cancelledOverlapCount: cancelledOverlaps.length,
          cancelledOverlapBookingIds: cancelledOverlaps.map((item) => item.id),
        },
      });
    }

    if (ownsClient) {
      await client.query("commit");
    }
    return {
      bookingId: booking.id,
      state: "ENTITLED",
      status: shouldConfirm ? "CONFIRMED" : String(booking.status ?? ""),
      paidToDate,
      depositRequired,
      cancelledOverlaps,
      winnerBookingId: booking.id,
    };
  } catch (error) {
    if (ownsClient) {
      await client.query("rollback");
    }
    throw error;
  } finally {
    if (ownsClient && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
}

export async function validateEntitlementAvailabilityForVehicle(
  input: { vehicleId: string } & OverlapWindowInput,
  options: { client?: Queryable; excludeBookingId?: string | null; includeBlockouts?: boolean } = {},
) {
  const unavailable = await isVehicleUnavailableEntitlementBased(
    input.vehicleId,
    { startAt: input.startAt, endAt: input.endAt },
    {
      client: options.client,
      excludeBookingId: options.excludeBookingId ?? null,
      includeBlockouts: options.includeBlockouts,
    },
  );
  return !unavailable;
}

export function readEntitlementSnapshot(pricing: MaybeRecord) {
  const source = toObject(pricing);
  return {
    paidToDate: Math.max(0, toNumber(source.amount_paid ?? source.paid_to_date)),
    depositRequired: Math.max(0, toNumber(source.deposit_required_cents ?? source.deposit_cents)),
    isEntitled: isEntitledBooking({ pricing_json: source }),
    winnerBookingId: toText(source.overridden_by_booking_id) || null,
    lostToBookingId: toText(source.entitlement_lost_to_booking_id) || null,
    refundReviewRequired: Boolean(source.refund_review_required),
  };
}

export function readEntitlementAmountPaid(pricing: MaybeRecord) {
  return Math.max(0, readAmountPaid(pricing ?? {}));
}
