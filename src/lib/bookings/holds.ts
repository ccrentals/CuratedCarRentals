import {
  isBlockingBookingHold,
  isNonBlockingBookingHold,
  normalizePaymentStatus,
  readAmountPaid,
  readHoldMinimumAmount,
  type Queryable,
} from "@/lib/payments/pricing";

const PRICING_AMOUNT_PAID_SQL = `coalesce(
  case
    when coalesce(b.pricing_json->>'amount_paid', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (b.pricing_json->>'amount_paid')::numeric
    else null
  end,
  case
    when coalesce(b.pricing_json->>'paid_to_date', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (b.pricing_json->>'paid_to_date')::numeric
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

const HOLD_MINIMUM_SQL = `coalesce(
  case
    when coalesce(b.pricing_json->>'hold_minimum_cents', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (b.pricing_json->>'hold_minimum_cents')::numeric
    else null
  end,
  case
    when coalesce(b.pricing_json->>'deposit_cents', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' then (b.pricing_json->>'deposit_cents')::numeric
    else null
  end,
  0
)`;

const PAYMENT_STATUS_SQL = `upper(coalesce(b.pricing_json->>'payment_status', 'UNPAID'))`;

const BLOCKING_SQL = `(${PAYMENT_STATUS_SQL} = 'PAID_IN_FULL' or (${AMOUNT_PAID_SQL} > 0 and ((${HOLD_MINIMUM_SQL} > 0 and ${AMOUNT_PAID_SQL} >= ${HOLD_MINIMUM_SQL}) or ${HOLD_MINIMUM_SQL} <= 0)))`;
const NON_BLOCKING_SQL = `(not ${BLOCKING_SQL} and ${PAYMENT_STATUS_SQL} in ('UNPAID', 'PENDING_PAYMENT', 'DUE_ON_PICKUP', 'DEPOSIT_PAID'))`;
const ACTIVE_BOOKING_SQL = "b.status not in ('CANCELLED','RETURNED')";

export type BookingOverrideInfo = {
  overriddenByBookingId: string | null;
  overriddenAt: string | null;
  overrideReason: string | null;
  isOverridden: boolean;
};

export type OverriddenBooking = {
  id: string;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
};

function asPricingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readBookingOverrideInfo(pricing: unknown): BookingOverrideInfo {
  const source = asPricingObject(pricing);
  const overriddenByBookingId = asNonEmptyString(source.overridden_by_booking_id);
  const overriddenAt = asNonEmptyString(source.overridden_at);
  const overrideReason = asNonEmptyString(source.override_reason);
  const isOverridden = Boolean(overriddenByBookingId || overriddenAt || overrideReason);
  return {
    overriddenByBookingId,
    overriddenAt,
    overrideReason,
    isOverridden,
  };
}

export function isBlockingPricing(pricing: unknown) {
  const source = asPricingObject(pricing);
  return isBlockingBookingHold({
    paymentStatus: source.payment_status,
    amountPaid: readAmountPaid(source),
    holdMinimumAmount: readHoldMinimumAmount(source),
  });
}

export function isNonBlockingPricing(pricing: unknown) {
  const source = asPricingObject(pricing);
  return isNonBlockingBookingHold({
    paymentStatus: source.payment_status,
    amountPaid: readAmountPaid(source),
    holdMinimumAmount: readHoldMinimumAmount(source),
  });
}

function buildOverriddenPricing(input: {
  existingPricing: unknown;
  overriddenByBookingId: string;
  overriddenAt: string;
  overrideReason: string;
}) {
  const existingPricing = asPricingObject(input.existingPricing);
  return {
    ...existingPricing,
    payment_status: normalizePaymentStatus(existingPricing.payment_status),
    amount_paid: readAmountPaid(existingPricing),
    overridden_by_booking_id: input.overriddenByBookingId,
    overridden_at: input.overriddenAt,
    override_reason: input.overrideReason,
  };
}

export async function findOverlappingBlockingBookingIds(
  db: Queryable,
  input: {
    vehicleId: string;
    startDate: string;
    endDate: string;
    excludeBookingId?: string | null;
    forUpdate?: boolean;
  },
) {
  const query =
    "select b.id from bookings b where b.vehicle_id = $1 and " +
    ACTIVE_BOOKING_SQL +
    " and not ($3 < b.start_date or $2 > b.end_date) and ($4::uuid is null or b.id <> $4::uuid) and " +
    BLOCKING_SQL +
    " order by b.created_at asc" +
    (input.forUpdate ? " for update" : "");

  const result = await db.query(query, [
    input.vehicleId,
    input.startDate,
    input.endDate,
    input.excludeBookingId ?? null,
  ]);

  return result.rows
    .map((row) => asNonEmptyString((row as { id?: unknown }).id))
    .filter((row): row is string => Boolean(row));
}

export async function overrideOverlappingNonBlockingBookings(
  db: Queryable,
  input: {
    paidBookingId: string;
    vehicleId: string;
    startDate: string;
    endDate: string;
    overrideReason?: string;
  },
): Promise<{
  blockingConflictIds: string[];
  overridden: OverriddenBooking[];
}> {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [input.vehicleId]);

  const blockingConflictIds = await findOverlappingBlockingBookingIds(db, {
    vehicleId: input.vehicleId,
    startDate: input.startDate,
    endDate: input.endDate,
    excludeBookingId: input.paidBookingId,
    forUpdate: true,
  });

  if (blockingConflictIds.length > 0) {
    return { blockingConflictIds, overridden: [] };
  }

  const overlappingNonBlocking = await db.query(
    "select b.id, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.vehicle_id = $1 and " +
      ACTIVE_BOOKING_SQL +
      " and b.id <> $4 and not ($3 < b.start_date or $2 > b.end_date) and " +
      NON_BLOCKING_SQL +
      " for update",
    [input.vehicleId, input.startDate, input.endDate, input.paidBookingId],
  );

  if (overlappingNonBlocking.rowCount === 0) {
    return { blockingConflictIds: [], overridden: [] };
  }

  const nowIso = new Date().toISOString();
  const overrideReason = input.overrideReason ?? "Overridden by paid booking";
  const overridden: OverriddenBooking[] = [];

  for (const row of overlappingNonBlocking.rows as Array<{
    id: string;
    start_date: string;
    end_date: string;
    pickup_location: string;
    pricing_json: unknown;
    customer_name: string;
    customer_email: string;
    vehicle_make: string;
    vehicle_model: string;
  }>) {
    const updatedPricing = buildOverriddenPricing({
      existingPricing: row.pricing_json,
      overriddenByBookingId: input.paidBookingId,
      overriddenAt: nowIso,
      overrideReason,
    });

    await db.query(
      "update bookings set status = 'CANCELLED', pricing_json = $2, updated_at = now() where id = $1",
      [row.id, updatedPricing],
    );

    overridden.push({
      id: row.id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
      startDate: row.start_date,
      endDate: row.end_date,
      pickupLocation: row.pickup_location,
    });
  }

  return { blockingConflictIds: [], overridden };
}
