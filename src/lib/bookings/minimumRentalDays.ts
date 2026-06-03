import { dateOnlyUtc } from "@/lib/payments/dateMath";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const JAMAICA_TIME_ZONE = "America/Jamaica";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function addDaysToDateInput(value: string, days: number) {
  const base = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return value;
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
}

function getJamaicaParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: JAMAICA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight:
      Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0,
  };
}

export function defaultBookingDateTime(input?: {
  now?: Date;
  minimumDays?: number;
}) {
  const minimumDays = Math.max(1, Math.floor(Number(input?.minimumDays ?? 2) || 2));
  const { date, minutesSinceMidnight } = getJamaicaParts(input?.now ?? new Date());
  const elevenAm = 11 * 60;
  const threePm = 15 * 60;

  let pickupDate = date;
  let pickupTime = "11:00";
  if (minutesSinceMidnight > elevenAm && minutesSinceMidnight <= threePm) {
    pickupTime = "15:00";
  } else if (minutesSinceMidnight > threePm) {
    pickupDate = addDaysToDateInput(date, 1);
  }

  return {
    pickupDate,
    pickupTime,
    dropoffDate: addDaysToDateInput(pickupDate, minimumDays),
    dropoffTime: pickupTime,
  };
}

export function restoredPickupIsBeforeDefault(input: {
  pickupDate: string;
  pickupTime: string;
  now?: Date;
  minimumDays?: number;
}) {
  const restoredPickup = new Date(`${input.pickupDate}T${input.pickupTime}:00`);
  if (Number.isNaN(restoredPickup.getTime())) return true;
  const defaultDateTime = defaultBookingDateTime({
    now: input.now,
    minimumDays: input.minimumDays,
  });
  const defaultPickup = new Date(`${defaultDateTime.pickupDate}T${defaultDateTime.pickupTime}:00`);
  if (Number.isNaN(defaultPickup.getTime())) return false;
  return restoredPickup < defaultPickup;
}

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
