import {
  normalizePageSize,
  STANDARD_PAGE_SIZE_OPTIONS,
  type StandardPageSize,
} from "@/lib/pagination/sharedPagination";

export const BOOKING_PAGE_SIZES = STANDARD_PAGE_SIZE_OPTIONS;

export type BookingPageSize = StandardPageSize;

export type BookingsCursor = {
  createdAt: string;
  startDate?: string;
  sortValue?: string;
  offset?: number;
  id: string;
};

export function normalizeBookingPageSize(value: unknown): BookingPageSize {
  return normalizePageSize(value, BOOKING_PAGE_SIZES, 10) as BookingPageSize;
}

export function encodeBookingsCursor(cursor: BookingsCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeBase64Json(input: string) {
  if (!input) return null;
  try {
    return Buffer.from(input, "base64url").toString("utf8");
  } catch {
    try {
      return Buffer.from(input, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
}

export function decodeBookingsCursor(value: unknown): BookingsCursor | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const decoded = decodeBase64Json(value.trim());
  if (!decoded) return null;

  try {
    const parsed = JSON.parse(decoded) as Partial<BookingsCursor>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.createdAt !== "string" || parsed.createdAt.trim().length === 0) return null;
    if (typeof parsed.id !== "string" || parsed.id.trim().length === 0) return null;
    const startDate =
      typeof parsed.startDate === "string" && parsed.startDate.trim().length > 0
        ? parsed.startDate.trim()
        : undefined;
    const sortValue =
      typeof parsed.sortValue === "string" && parsed.sortValue.trim().length > 0
        ? parsed.sortValue.trim()
        : undefined;
    const offset =
      Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0
        ? Number(parsed.offset)
        : undefined;
    const baseCursor: BookingsCursor = {
      createdAt: parsed.createdAt.trim(),
      id: parsed.id.trim(),
    };
    if (startDate) {
      baseCursor.startDate = startDate;
    }
    if (sortValue) {
      baseCursor.sortValue = sortValue;
    }
    if (offset !== undefined) {
      baseCursor.offset = offset;
    }
    return baseCursor;
  } catch {
    return null;
  }
}

export function withBookingPageSizeSearchParams(currentQuery: string, pageSize: string) {
  const next = new URLSearchParams(currentQuery);
  next.set("pageSize", pageSize);
  next.delete("cursor");
  return next;
}

export function mergeBookingsById<T extends { id: string }>(existing: T[], incoming: T[]) {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((row) => row.id));
  const appended: T[] = [];
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    appended.push(row);
  }
  return [...existing, ...appended];
}
