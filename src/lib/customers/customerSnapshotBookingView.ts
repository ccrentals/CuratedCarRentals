import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

export type CustomerSnapshotBookingSource = {
  id: string;
  public_id: string | null;
  start_date: string | Date;
  end_date: string | Date;
  created_at: string | Date;
  status: string;
  pricing_json: Record<string, unknown> | null;
  vehicle_make: string;
  vehicle_model: string;
};

export type CustomerSnapshotBookingItem = {
  id: string;
  publicId: string;
  vehicleLabel: string;
  startDateValue: string;
  startDateLabel: string;
  endDateValue: string;
  endDateLabel: string;
  status: string;
  statusLabel: string;
  totalAmount: number;
  totalLabel: string;
  balanceAmount: number;
  balanceLabel: string;
  createdAtValue: string;
  createdAtLabel: string;
};

export const CUSTOMER_SNAPSHOT_SORT_COLUMNS = [
  "booking",
  "vehicle",
  "dates",
  "status",
  "total",
  "balance",
  "created",
] as const;

export type CustomerSnapshotSortBy = (typeof CUSTOMER_SNAPSHOT_SORT_COLUMNS)[number];
export type CustomerSnapshotSortDir = "asc" | "desc";

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asMoney(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatStatusLabel(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Unknown";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function asIsoTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return String(value ?? "");
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareNumber(left: number, right: number) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareByDateRange(
  left: Pick<CustomerSnapshotBookingItem, "startDateValue" | "endDateValue">,
  right: Pick<CustomerSnapshotBookingItem, "startDateValue" | "endDateValue">,
) {
  const startCompare = compareText(left.startDateValue, right.startDateValue);
  if (startCompare !== 0) return startCompare;
  return compareText(left.endDateValue, right.endDateValue);
}

export function mapCustomerSnapshotBookingRow(
  row: CustomerSnapshotBookingSource,
): CustomerSnapshotBookingItem {
  const pricing = asRecord(row.pricing_json);
  const total = asMoney(pricing?.total_amount) || asMoney(pricing?.total_cents);
  const balance = asMoney(pricing?.balance_due);

  return {
    id: row.id,
    publicId: String(row.public_id ?? "").trim() || row.id,
    vehicleLabel: `${row.vehicle_make} ${row.vehicle_model}`.trim(),
    startDateValue: typeof row.start_date === "string" ? row.start_date : row.start_date.toISOString(),
    startDateLabel: fmtDate(row.start_date),
    endDateValue: typeof row.end_date === "string" ? row.end_date : row.end_date.toISOString(),
    endDateLabel: fmtDate(row.end_date),
    status: row.status,
    statusLabel: formatStatusLabel(row.status),
    totalAmount: total,
    totalLabel: formatJmd(total),
    balanceAmount: balance,
    balanceLabel: formatJmd(balance),
    createdAtValue: asIsoTimestamp(row.created_at),
    createdAtLabel: fmtDate(row.created_at),
  };
}

export function sortCustomerSnapshotBookings(
  rows: CustomerSnapshotBookingItem[],
  sortBy: CustomerSnapshotSortBy,
  sortDir: CustomerSnapshotSortDir,
) {
  const direction = sortDir === "desc" ? -1 : 1;

  return [...rows].sort((left, right) => {
    let result = 0;

    if (sortBy === "booking") {
      result = compareText(left.publicId, right.publicId);
    } else if (sortBy === "vehicle") {
      result = compareText(left.vehicleLabel, right.vehicleLabel);
    } else if (sortBy === "dates") {
      result = compareByDateRange(left, right);
    } else if (sortBy === "status") {
      result = compareText(left.statusLabel, right.statusLabel);
    } else if (sortBy === "total") {
      result = compareNumber(left.totalAmount, right.totalAmount);
    } else if (sortBy === "balance") {
      result = compareNumber(left.balanceAmount, right.balanceAmount);
    } else {
      result = compareText(left.createdAtValue, right.createdAtValue);
    }

    if (result !== 0) return result * direction;
    return compareText(left.publicId, right.publicId);
  });
}
