import { dbQuery } from "@/lib/db";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";

export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

export type PaymentOption = "DEPOSIT" | "FULL" | "PAY_ON_PICKUP";
export type PaymentStatus = "UNPAID" | "DUE_ON_PICKUP" | "DEPOSIT_PAID" | "PAID_IN_FULL";

export type BookingPricingSummary = {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  days: number;
  dailyRate: number;
  subtotal: number;
  promoCode: string | null;
  promoDiscount: number;
  total: number;
  deposit: number;
  paymentOption: PaymentOption;
  netPaidToDate: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  refundRequired: boolean;
};
export { calcDaysInclusive, dateOnlyUtc };

const NON_BLOCKING_PAYMENT_STATUSES = new Set<PaymentStatus>([
  "UNPAID",
  "DUE_ON_PICKUP",
  "DEPOSIT_PAID",
]);

function toMoneyLike(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return amount;
}

export function normalizePaymentOption(value: unknown): PaymentOption {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "FULL") return "FULL";
  if (normalized === "PAY_ON_PICKUP") return "PAY_ON_PICKUP";
  return "DEPOSIT";
}

export function normalizePaymentStatus(value: unknown): PaymentStatus {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "PAID_IN_FULL") return "PAID_IN_FULL";
  if (normalized === "DEPOSIT_PAID") return "DEPOSIT_PAID";
  if (normalized === "DUE_ON_PICKUP") return "DUE_ON_PICKUP";
  return "UNPAID";
}

export function readPaymentOption(pricing: Record<string, unknown> | null | undefined): PaymentOption {
  const source = pricing ?? {};
  return normalizePaymentOption(source.payment_option_selected);
}

export function readAmountPaid(
  pricing: Record<string, unknown> | null | undefined,
): number {
  const source = pricing ?? {};
  return toMoneyLike(source.amount_paid ?? source.paid_to_date ?? 0);
}

export function readHoldMinimumAmount(
  pricing: Record<string, unknown> | null | undefined,
): number {
  const source = pricing ?? {};
  const explicitMinimum = toMoneyLike(source.hold_minimum_cents);
  if (explicitMinimum > 0) return explicitMinimum;
  const depositAmount = toMoneyLike(source.deposit_cents);
  if (depositAmount > 0) return depositAmount;
  return 0;
}

export function isBlockingBookingHold(input: {
  paymentStatus: unknown;
  amountPaid: unknown;
  holdMinimumAmount?: unknown;
}) {
  const amountPaid = toMoneyLike(input.amountPaid);
  const paymentStatus = normalizePaymentStatus(input.paymentStatus);
  const holdMinimumAmount = Math.max(0, toMoneyLike(input.holdMinimumAmount));

  if (paymentStatus === "PAID_IN_FULL") return true;
  if (amountPaid <= 0) return false;

  if (holdMinimumAmount > 0) {
    return amountPaid >= holdMinimumAmount;
  }

  // Legacy fallback: if no hold minimum is stored, preserve historical behavior.
  return paymentStatus === "DEPOSIT_PAID" || amountPaid > 0;
}

export function isNonBlockingBookingHold(input: {
  paymentStatus: unknown;
  amountPaid: unknown;
  holdMinimumAmount?: unknown;
}) {
  const paymentStatus = normalizePaymentStatus(input.paymentStatus);
  if (isBlockingBookingHold(input)) return false;
  return NON_BLOCKING_PAYMENT_STATUSES.has(paymentStatus);
}

export function readPromoPricingFields(pricing: Record<string, unknown> | null | undefined) {
  const source = pricing ?? {};
  const promoCode =
    typeof source.promo_code === "string" && source.promo_code.trim().length > 0
      ? source.promo_code.trim().toUpperCase()
      : null;
  const promoDiscount = Number(source.promo_discount_cents ?? 0);
  return { promoCode, promoDiscount };
}

export function computeBookingPricing(input: {
  bookingId: string;
  bookingStatus: string;
  startDate: unknown;
  endDate: unknown;
  dailyRate: number;
  deposit: number;
  paymentOption?: PaymentOption | null | undefined;
  netPaidToDate: number;
  promoCode?: string | null;
  promoDiscount?: number;
}): Omit<BookingPricingSummary, "startDate" | "endDate"> & { startDate: string; endDate: string } {
  const days = calcDaysInclusive(input.startDate, input.endDate);
  const dailyRate = Number.isFinite(input.dailyRate) ? Number(input.dailyRate) : 0;
  const deposit = Number.isFinite(input.deposit) ? Number(input.deposit) : 0;
  const netPaidToDate = Number.isFinite(input.netPaidToDate) ? Number(input.netPaidToDate) : 0;
  const subtotal = dailyRate * days;
  const promoCode =
    typeof input.promoCode === "string" && input.promoCode.trim().length > 0
      ? input.promoCode.trim().toUpperCase()
      : null;
  const paymentOption = normalizePaymentOption(input.paymentOption);
  const promoDiscountRaw = Number.isFinite(input.promoDiscount) ? Number(input.promoDiscount) : 0;
  const promoDiscount = Math.max(0, Math.min(subtotal, promoDiscountRaw));
  const total = Math.max(0, subtotal - promoDiscount);

  const balanceDue = Math.max(0, total - netPaidToDate);
  const paymentStatus: PaymentStatus =
    balanceDue === 0 && total > 0
      ? "PAID_IN_FULL"
      : netPaidToDate > 0
        ? "DEPOSIT_PAID"
        : paymentOption === "PAY_ON_PICKUP"
          ? "DUE_ON_PICKUP"
          : "UNPAID";

  const statusUpper = String(input.bookingStatus || "").toUpperCase();
  const refundRequired = netPaidToDate > total || (statusUpper === "CANCELLED" && netPaidToDate > 0);

  const startDate = typeof input.startDate === "string" ? input.startDate : String(input.startDate ?? "");
  const endDate = typeof input.endDate === "string" ? input.endDate : String(input.endDate ?? "");

  return {
    bookingId: input.bookingId,
    bookingStatus: String(input.bookingStatus || ""),
    startDate,
    endDate,
    days,
    dailyRate,
    subtotal,
    promoCode,
    promoDiscount,
    total,
    deposit,
    paymentOption,
    netPaidToDate,
    balanceDue,
    paymentStatus,
    refundRequired,
  };
}

function getQueryable(client?: Queryable) {
  if (client) return client;
  return { query: (text: string, params: unknown[] = []) => dbQuery(text, params) };
}

export async function fetchNetPaidToDate(
  bookingId: string,
  options: { client?: Queryable } = {},
): Promise<number> {
  const db = getQueryable(options.client);

  // Successful money movements:
  // - DEPOSIT_PAID: captured payments (deposit/balance/manual)
  // - REFUNDED: refund rows (stored as negative amounts)
  try {
    const result = await db.query(
      "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and deleted_at is null and status in ('DEPOSIT_PAID','REFUNDED')",
      [bookingId],
    );
    return Number(result.rows[0]?.amount ?? 0);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    // Graceful fallback if DB hasn't been migrated yet.
    if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
      const result = await db.query(
        "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status in ('DEPOSIT_PAID','REFUNDED')",
        [bookingId],
      );
      return Number(result.rows[0]?.amount ?? 0);
    }
    throw error;
  }
}

export async function getBookingPricingSummary(
  bookingId: string,
  options: { client?: Queryable } = {},
): Promise<BookingPricingSummary> {
  const db = getQueryable(options.client);

  const bookingResult = await db.query(
    "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [bookingId],
  );

  if (bookingResult.rowCount === 0) {
    throw new Error("Booking not found");
  }

  const booking = bookingResult.rows[0] as {
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    pricing_json: Record<string, unknown> | null;
    daily_rate_cents: number;
    deposit_cents: number;
  };

  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
  const paymentOption = readPaymentOption(pricing);
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const netPaidToDate = await fetchNetPaidToDate(bookingId, options);

  return computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    paymentOption,
    netPaidToDate,
    promoCode,
    promoDiscount,
  });
}
