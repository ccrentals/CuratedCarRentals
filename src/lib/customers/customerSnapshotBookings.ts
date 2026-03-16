import {
  decodeBookingsCursor,
  encodeBookingsCursor,
  normalizeBookingPageSize,
  type BookingPageSize,
} from "@/lib/bookings/adminBookingsPagination";
import {
  mapCustomerSnapshotBookingRow,
  type CustomerSnapshotBookingItem,
  type CustomerSnapshotBookingSource,
} from "@/lib/customers/customerSnapshotBookingView";
import { dbQuery } from "@/lib/db";

export type CustomerSnapshotBookingsPage = {
  bookings: CustomerSnapshotBookingItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  limit: BookingPageSize;
};

export type CustomerSnapshotBookingsQueryInput = {
  customerId: string;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: unknown;
  cursor?: unknown;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asIsoTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return String(value ?? "");
}

function normalizeStatusFilter(raw: unknown) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim().toUpperCase();
  return normalized || "";
}

export async function fetchCustomerSnapshotBookingsPage(
  input: CustomerSnapshotBookingsQueryInput,
): Promise<CustomerSnapshotBookingsPage> {
  const limit = normalizeBookingPageSize(input.limit);
  const statusFilter = normalizeStatusFilter(input.status);
  const dateFrom =
    typeof input.dateFrom === "string" && DATE_RE.test(input.dateFrom) ? input.dateFrom : "";
  const dateTo =
    typeof input.dateTo === "string" && DATE_RE.test(input.dateTo) ? input.dateTo : "";
  const cursor = decodeBookingsCursor(input.cursor);

  const baseWhereParts: string[] = ["b.customer_id = $1"];
  const baseValues: Array<string | number> = [input.customerId];
  let baseIndex = 2;

  if (statusFilter) {
    baseWhereParts.push(`b.status = $${baseIndex}`);
    baseValues.push(statusFilter);
    baseIndex += 1;
  }

  if (dateFrom) {
    baseWhereParts.push(`b.start_date >= $${baseIndex}`);
    baseValues.push(dateFrom);
    baseIndex += 1;
  }

  if (dateTo) {
    baseWhereParts.push(`b.end_date <= $${baseIndex}`);
    baseValues.push(dateTo);
    baseIndex += 1;
  }

  const whereParts = [...baseWhereParts];
  const values = [...baseValues];
  let index = baseIndex;

  if (cursor) {
    whereParts.push(
      `(b.created_at < $${index}::timestamptz or (b.created_at = $${index}::timestamptz and b.id::text < $${index + 1}::text))`,
    );
    values.push(cursor.createdAt);
    values.push(cursor.id);
    index += 2;
  }

  values.push(limit + 1);
  const limitIndex = values.length;

  const result = await dbQuery<CustomerSnapshotBookingSource>(
    "select b.id, b.public_id, b.start_date, b.end_date, b.created_at, b.status, b.pricing_json, v.make as vehicle_make, v.model as vehicle_model from bookings b join vehicles v on v.id = b.vehicle_id where " +
      whereParts.join(" and ") +
      ` order by b.created_at desc, b.id::text desc limit $${limitIndex}`,
    values,
  );

  const countResult = await dbQuery<{ total_count: unknown }>(
    "select count(*)::int as total_count from bookings b where " + baseWhereParts.join(" and "),
    baseValues,
  );
  const totalCount = Number(countResult.rows[0]?.total_count ?? 0);

  const hasMore = result.rows.length > limit;
  const visibleRows: CustomerSnapshotBookingSource[] = hasMore
    ? result.rows.slice(0, limit)
    : result.rows;

  const bookings: CustomerSnapshotBookingItem[] = visibleRows.map(mapCustomerSnapshotBookingRow);

  const nextCursor =
    hasMore && visibleRows.length > 0
      ? encodeBookingsCursor({
          createdAt: asIsoTimestamp(visibleRows[visibleRows.length - 1].created_at),
          id: visibleRows[visibleRows.length - 1].id,
        })
      : null;

  return {
    bookings,
    nextCursor,
    hasMore: Boolean(nextCursor),
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
    limit,
  };
}
