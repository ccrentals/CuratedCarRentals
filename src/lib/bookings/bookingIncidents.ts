import { dbQuery } from "@/lib/db";

const BOOKING_INCIDENT_ACTIONS = [
  "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_ALERTED",
  "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED",
  "RESEND_EMAIL_DELIVERY_ISSUE",
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BookingIncidentAction = (typeof BOOKING_INCIDENT_ACTIONS)[number];

type AuditIncidentRow = {
  id: string;
  action: string;
  details_json: unknown;
  created_at: string | Date;
};

type BookingIncidentQueryFn = <T = unknown>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[]; rowCount: number }>;

export type BookingIncidentType =
  | "INSPECTION_FUEL_MISMATCH"
  | "INSPECTION_DAMAGE"
  | "EMAIL_DELIVERY_ISSUE";

export type BookingIncidentSeverity = "critical" | "warning";

export type BookingIncidentSummary = {
  id: string;
  bookingId: string;
  type: BookingIncidentType;
  severity: BookingIncidentSeverity;
  title: string;
  summary: string;
  occurredAt: string;
  sourceLabel: string;
  messageId: string | null;
  actionHref: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value: string | Date) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  const text = asString(value);
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text;
}

function readMessageId(details: Record<string, unknown> | null) {
  const candidate = asString(details?.notificationId);
  return UUID_REGEX.test(candidate) ? candidate : null;
}

function buildFuelMismatchSummary(details: Record<string, unknown> | null) {
  const pickupFuel = asString(details?.pickupFuelDisplay);
  const returnFuel = asString(details?.returnFuelDisplay);

  if (pickupFuel && returnFuel) {
    return `Return fuel (${returnFuel}) is below pickup fuel (${pickupFuel}).`;
  }

  return "Return fuel is below pickup fuel.";
}

function buildDamageSummary() {
  return "Return inspection indicates vehicle damage.";
}

function buildEmailDeliveryTitle(details: Record<string, unknown> | null) {
  const eventType = asString(details?.eventType).toLowerCase();
  if (eventType === "email.bounced") return "Booking email bounced";
  if (eventType === "email.failed") return "Booking email failed";
  return "Booking email delivery issue";
}

function buildEmailDeliverySummary(details: Record<string, unknown> | null) {
  const eventType = asString(details?.eventType).toLowerCase();
  const recipient = asString(details?.recipientEmail);
  const reason = asString(details?.reason);

  const base =
    eventType === "email.bounced"
      ? recipient
        ? `Email to ${recipient} bounced.`
        : "A booking email bounced."
      : eventType === "email.failed"
        ? recipient
          ? `Email to ${recipient} failed to deliver.`
          : "A booking email failed to deliver."
        : recipient
          ? `Email to ${recipient} had a delivery issue.`
          : "A booking email had a delivery issue.";

  return reason ? `${base} ${reason}` : base;
}

function mapAuditIncident(
  row: AuditIncidentRow,
  bookingId: string,
): BookingIncidentSummary | null {
  const details = asRecord(row.details_json);
  const messageId = readMessageId(details);

  const shared = {
    id: row.id,
    bookingId,
    occurredAt: normalizeTimestamp(row.created_at),
    messageId,
    actionHref: messageId ? `/admin/messages/${messageId}` : null,
  };

  switch (row.action as BookingIncidentAction) {
    case "BOOKING_VEHICLE_INSPECTION_DAMAGE_ALERTED":
      return {
        ...shared,
        type: "INSPECTION_DAMAGE",
        severity: "critical",
        title: "Damage reported on return inspection",
        summary: buildDamageSummary(),
        sourceLabel: "Vehicle inspection",
      };
    case "BOOKING_VEHICLE_INSPECTION_FUEL_MISMATCH_ALERTED":
      return {
        ...shared,
        type: "INSPECTION_FUEL_MISMATCH",
        severity: "warning",
        title: "Fuel mismatch reported",
        summary: buildFuelMismatchSummary(details),
        sourceLabel: "Vehicle inspection",
      };
    case "RESEND_EMAIL_DELIVERY_ISSUE":
      return {
        ...shared,
        type: "EMAIL_DELIVERY_ISSUE",
        severity: "warning",
        title: buildEmailDeliveryTitle(details),
        summary: buildEmailDeliverySummary(details),
        sourceLabel: "Email delivery",
      };
    default:
      return null;
  }
}

function compareIncidents(left: BookingIncidentSummary, right: BookingIncidentSummary) {
  const severityRank: Record<BookingIncidentSeverity, number> = {
    critical: 0,
    warning: 1,
  };

  const severityDiff = severityRank[left.severity] - severityRank[right.severity];
  if (severityDiff !== 0) return severityDiff;

  const leftTime = new Date(left.occurredAt).getTime();
  const rightTime = new Date(right.occurredAt).getTime();
  return rightTime - leftTime;
}

export async function loadBookingIncidents(
  bookingId: string,
  queryFn: BookingIncidentQueryFn = dbQuery,
) {
  const result = await queryFn<AuditIncidentRow>(
    "select id::text as id, action, details_json, created_at from audit_logs where entity_type = 'booking' and entity_id = $1::uuid and action = any($2::text[]) order by created_at desc limit 50",
    [bookingId, [...BOOKING_INCIDENT_ACTIONS]],
  );

  return result.rows
    .map((row) => mapAuditIncident(row, bookingId))
    .filter((row): row is BookingIncidentSummary => row !== null)
    .sort(compareIncidents);
}

export { BOOKING_INCIDENT_ACTIONS };
