import { formatJmdDecimal } from "@/lib/money";
import { isISODate } from "@/lib/validators";

export function isAdminCreateBookingDateRangeValid(startDate: string, endDate: string) {
  return isISODate(startDate) && isISODate(endDate) && endDate >= startDate;
}

export function suggestAdminCreateBookingEndDate(startDate: string, offsetDays = 2): string | null {
  if (!isISODate(startDate)) return null;

  const date = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function suggestAdminCreateBookingPaymentAmount(
  depositRequiredAmount: number | null | undefined,
): string {
  if (!Number.isFinite(depositRequiredAmount)) return "";

  const normalizedAmount = Math.max(0, Number(depositRequiredAmount));
  if (normalizedAmount <= 0) return "";

  return formatJmdDecimal(normalizedAmount);
}
