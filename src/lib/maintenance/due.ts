export type ComputeNextDueInput = {
  intervalDays: number | null;
  intervalOdometer: number | null;
  lastServiceDate: string | null;
  lastServiceOdometer: number | null;
};

export type NextDueResult = {
  nextDueDate: string | null;
  nextDueOdometer: number | null;
};

type DueSoonInput = {
  nextDueDate: string | null;
  now?: Date;
  leadDays: number;
};

function parseDateOnly(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function asPositiveInt(value: number | null) {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : null;
}

function asNonNegativeInt(value: number | null) {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

export function computeNextDue(input: ComputeNextDueInput): NextDueResult {
  const intervalDays = asPositiveInt(input.intervalDays);
  const intervalOdometer = asPositiveInt(input.intervalOdometer);
  const lastServiceDate = parseDateOnly(input.lastServiceDate);
  const lastServiceOdometer = asNonNegativeInt(input.lastServiceOdometer);

  let nextDueDate: string | null = null;
  let nextDueOdometer: number | null = null;

  if (intervalDays !== null && lastServiceDate) {
    const next = new Date(lastServiceDate.getTime());
    next.setUTCDate(next.getUTCDate() + intervalDays);
    nextDueDate = toDateOnly(next);
  }

  if (intervalOdometer !== null && lastServiceOdometer !== null) {
    nextDueOdometer = lastServiceOdometer + intervalOdometer;
  }

  return { nextDueDate, nextDueOdometer };
}

export function isDateDueSoon({ nextDueDate, now = new Date(), leadDays }: DueSoonInput) {
  if (!nextDueDate) return false;
  const due = parseDateOnly(nextDueDate);
  if (!due) return false;

  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + Math.max(0, Math.round(leadDays)));

  return due.getTime() >= start.getTime() && due.getTime() <= end.getTime();
}

