import { fmtDateNoSeconds, fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import { REMINDER_EVENTS, type ReminderEventType } from "@/lib/cron/reminderTypes";

export type ReminderEventSummary = {
  primary: string;
  badges: string[];
  secondary: string[];
  error: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStatusCode(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return readString(value);
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatReminderDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fmtDateOnly(value);
}

function reminderSubtype(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;
  return raw
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => capitalize(part))
    .join(" ");
}

function formatErrorName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => capitalize(part))
    .join(" ");
}

function normalizeErrorMessage(value: unknown) {
  const raw = readString(value);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const details = asObject(parsed);
    if (!details) return raw;
    const message =
      readString(details.message) ??
      readString(details.error_description) ??
      readString(details.error);
    if (!message) return raw;

    const name = readString(details.name);
    const statusCode = readStatusCode(details.statusCode);
    const prefix =
      name && statusCode
        ? `${formatErrorName(name)} (${statusCode})`
        : name
          ? formatErrorName(name)
          : statusCode
            ? `Error ${statusCode}`
            : null;

    return prefix ? `${prefix}: ${message}` : message;
  } catch {
    return raw;
  }
}

function fallbackSummary(details: Record<string, unknown>): ReminderEventSummary {
  const secondary = Object.entries(details)
    .slice(0, 3)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: —`;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    });

  return {
    primary: secondary[0] ?? "Reminder event logged",
    badges: [],
    secondary: secondary.slice(1),
    error: null,
  };
}

function balanceLabel(details: Record<string, unknown>) {
  const amount = readNumber(details.balance_due);
  return amount === null ? null : `Balance ${formatJmd(amount)}`;
}

export function summarizeReminderEvent(
  action: ReminderEventType | string,
  detailsValue: unknown,
): ReminderEventSummary {
  const details = asObject(detailsValue);
  if (!details) {
    const raw = readString(detailsValue);
    return {
      primary: raw ?? "Reminder event logged",
      badges: [],
      secondary: [],
      error: null,
    };
  }

  const badges: string[] = [];
  const secondary: string[] = [];
  const error = normalizeErrorMessage(details.error);

  if (details.simulated === true) {
    badges.push("Simulated");
  }

  const customerName = readString(details.customer_name);
  const vehicle = readString(details.vehicle);
  const pickupDate = readString(details.pickup_date) ?? readString(details.start_date);
  const dropoffDate = readString(details.dropoff_date) ?? readString(details.end_date);
  const scheduledFor = readString(details.scheduled_for) ?? readString(details.note_scheduled_for);
  const targets = readStringArray(details.targets);
  const target = readString(details.note_email_target);
  const reminderType = reminderSubtype(details.reminder_type);
  const runStatus = readString(details.run_status);
  const errorCount = readNumber(details.error_count);
  const reason = readString(details.reason);
  const mode = readString(details.mode);
  const balance = balanceLabel(details);

  if (customerName) secondary.push(customerName);
  if (vehicle) secondary.push(vehicle);
  if (pickupDate) secondary.push(`Pickup ${formatReminderDate(pickupDate)}`);
  if (dropoffDate) secondary.push(`Dropoff ${formatReminderDate(dropoffDate)}`);
  if (scheduledFor) secondary.push(`Scheduled ${fmtDateNoSeconds(scheduledFor)}`);
  if (balance) secondary.push(balance);
  if (targets.length > 0) secondary.push(`Targets ${targets.join(", ")}`);
  if (target) secondary.push(`Target ${target}`);
  if (reminderType) secondary.push(reminderType);
  if (typeof errorCount === "number" && errorCount > 0) secondary.push(`Errors ${errorCount}`);
  if (mode && details.simulated === true) secondary.push(`Mode ${mode}`);
  if (runStatus && details.simulated === true) secondary.push(`Run ${runStatus.toLowerCase()}`);

  if (action === REMINDER_EVENTS.PICKUP_SENT || action === REMINDER_EVENTS.PICKUP_FAILED) {
    return {
      primary: pickupDate ? `Pickup reminder for ${formatReminderDate(pickupDate)}` : "Pickup reminder event",
      badges,
      secondary,
      error,
    };
  }

  if (
    action === REMINDER_EVENTS.BALANCE_SENT ||
    action === REMINDER_EVENTS.BALANCE_FAILED ||
    action === REMINDER_EVENTS.DROPOFF_SENT ||
    action === REMINDER_EVENTS.DROPOFF_FAILED ||
    action === REMINDER_EVENTS.LATE_DROPOFF_SENT ||
    action === REMINDER_EVENTS.LATE_DROPOFF_FAILED
  ) {
    return {
      primary: dropoffDate
        ? `${reminderType ?? "Balance"} reminder for ${formatReminderDate(dropoffDate)}`
        : `${reminderType ?? "Balance"} reminder event`,
      badges,
      secondary,
      error,
    };
  }

  if (action === REMINDER_EVENTS.NOTE_SENT) {
    return {
      primary: scheduledFor
        ? `Scheduled note for ${fmtDateNoSeconds(scheduledFor)}`
        : "Scheduled note email sent",
      badges,
      secondary,
      error,
    };
  }

  if (action === REMINDER_EVENTS.NOTE_FAILED) {
    return {
      primary: scheduledFor
        ? `Scheduled note failed for ${fmtDateNoSeconds(scheduledFor)}`
        : "Scheduled note email failed",
      badges,
      secondary,
      error,
    };
  }

  if (action === REMINDER_EVENTS.NOTE_CANCELLED) {
    return {
      primary: scheduledFor
        ? `Scheduled note cancelled for ${fmtDateNoSeconds(scheduledFor)}`
        : "Scheduled note email cancelled",
      badges,
      secondary: reason ? [...secondary, `Reason ${reason}`] : secondary,
      error,
    };
  }

  return fallbackSummary(details);
}
