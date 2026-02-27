export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "EXPIRED",
  "CONVERTED",
  "CANCELLED",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const TERMINAL_STATUSES = new Set<QuoteStatus>(["EXPIRED", "CONVERTED", "CANCELLED"]);
const AUTO_EXPIRE_STATUSES = new Set<QuoteStatus>(["DRAFT", "SENT", "ACCEPTED"]);

const QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, ReadonlySet<QuoteStatus>> = {
  DRAFT: new Set<QuoteStatus>(["SENT", "CANCELLED"]),
  SENT: new Set<QuoteStatus>(["ACCEPTED", "EXPIRED", "CANCELLED"]),
  ACCEPTED: new Set<QuoteStatus>(["CONVERTED", "EXPIRED", "CANCELLED"]),
  EXPIRED: new Set<QuoteStatus>([]),
  CONVERTED: new Set<QuoteStatus>([]),
  CANCELLED: new Set<QuoteStatus>([]),
};

export function normalizeQuoteStatus(value: unknown): QuoteStatus | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (QUOTE_STATUSES.includes(normalized as QuoteStatus)) {
    return normalized as QuoteStatus;
  }
  return null;
}

export function isQuoteExpired(expiresAt: string | Date | null | undefined, now = new Date()) {
  if (!expiresAt) return false;
  const expires = expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
  if (Number.isNaN(expires.getTime())) return false;
  return now.getTime() > expires.getTime();
}

export function resolveEffectiveQuoteStatus(
  status: string | null | undefined,
  expiresAt: string | Date | null | undefined,
  now = new Date(),
): QuoteStatus {
  const normalized = normalizeQuoteStatus(status) ?? "DRAFT";
  if (TERMINAL_STATUSES.has(normalized)) return normalized;
  if (AUTO_EXPIRE_STATUSES.has(normalized) && isQuoteExpired(expiresAt, now)) {
    return "EXPIRED";
  }
  return normalized;
}

export function isQuoteStatusTransitionAllowed(fromStatus: QuoteStatus, toStatus: QuoteStatus) {
  if (fromStatus === toStatus) return true;
  return QUOTE_STATUS_TRANSITIONS[fromStatus].has(toStatus);
}

export function getQuoteStatusTransitionError(
  fromStatus: QuoteStatus,
  toStatus: QuoteStatus,
): string | null {
  if (isQuoteStatusTransitionAllowed(fromStatus, toStatus)) {
    return null;
  }
  return `Invalid quote status transition: ${fromStatus} -> ${toStatus}`;
}

