export type MaybeRecord = Record<string, unknown> | null | undefined;

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isClosedStatus(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return normalized === "CANCELLED" || normalized === "RETURNED" || normalized === "OVERRIDDEN";
}

function readDepositRequired(pricing: MaybeRecord, fallbackDeposit = 0) {
  const source = toObject(pricing);
  const explicit = toNumber(source.deposit_required_cents);
  if (explicit > 0) return explicit;
  const deposit = toNumber(source.deposit_cents);
  if (deposit > 0) return deposit;
  return Math.max(0, fallbackDeposit);
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
  if (isClosedStatus(booking.status)) return false;
  const pricing = toObject(pricingSnapshot ?? booking.pricing_json);
  const paymentStatus = String(
    booking.paymentStatus ?? pricing.payment_status ?? "",
  )
    .trim()
    .toUpperCase();
  const paidToDate = toNumber(
    booking.paidToDate ?? pricing.amount_paid ?? pricing.paid_to_date ?? 0,
  );
  const depositRequired = Math.max(
    0,
    toNumber(
      booking.depositRequired ?? readDepositRequired(pricing, toNumber(booking.depositFallback)),
    ),
  );
  return paymentStatus === "PAID_IN_FULL" || paidToDate >= depositRequired;
}
