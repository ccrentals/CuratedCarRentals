import { dateOnlyUtc } from "@/lib/payments/dateMath";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function calcElapsedCalendarDays(start: unknown, end: unknown) {
  const normalizedStart = dateOnlyUtc(start);
  const normalizedEnd = dateOnlyUtc(end);
  if (!normalizedStart || !normalizedEnd) return 0;
  return Math.floor((normalizedEnd.getTime() - normalizedStart.getTime()) / MS_PER_DAY);
}

export function minimumRentalDaysMessage(minimumDays: number) {
  const days = Math.max(1, Math.floor(minimumDays));
  return `Minimum rental period is ${days} ${days === 1 ? "day" : "days"}.`;
}

export function validateMinimumRentalDays(input: {
  start: unknown;
  end: unknown;
  minimumDays: number;
}) {
  const elapsedDays = calcElapsedCalendarDays(input.start, input.end);
  const minimumDays = Math.max(1, Math.floor(input.minimumDays));
  return {
    ok: elapsedDays >= minimumDays,
    elapsedDays,
    minimumDays,
    message: elapsedDays >= minimumDays ? null : minimumRentalDaysMessage(minimumDays),
  };
}
