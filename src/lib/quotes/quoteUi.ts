import { siteContent } from "@/data/content";
import { fmtDateNoSeconds } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

export const QUOTE_STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Draft", value: "DRAFT" },
  { label: "Sent", value: "SENT" },
  { label: "Accepted", value: "ACCEPTED" },
  { label: "Expired", value: "EXPIRED" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Cancelled", value: "CANCELLED" },
] as const;

export type QuoteStatusValue = (typeof QUOTE_STATUS_OPTIONS)[number]["value"];

const QUOTE_STATUS_SET = new Set<string>(
  QUOTE_STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => option.value),
);

export function normalizeQuoteStatusFilter(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return "all";
  return QUOTE_STATUS_SET.has(normalized) ? normalized : "all";
}

export function quoteStatusLabel(status: string | null | undefined) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  if (!normalized) return "DRAFT";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0] + segment.slice(1).toLowerCase())
    .join(" ");
}

export const QUOTE_STATUS_PILL_BASE_CLASS =
  "inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold leading-none";

export function quoteStatusPillToneClass(status: string | null | undefined) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "SENT") {
    return "border-sky-300/40 bg-sky-500/15 text-sky-100";
  }
  if (normalized === "ACCEPTED") {
    return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  }
  if (normalized === "EXPIRED") {
    return "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent)]";
  }
  if (normalized === "CONVERTED") {
    return "border-cyan-300/40 bg-cyan-500/15 text-cyan-100";
  }
  if (normalized === "CANCELLED") {
    return "border-rose-300/45 bg-rose-500/15 text-rose-100";
  }

  return "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
}

export function shortQuoteId(value: string, publicId?: string | null) {
  const normalizedPublicId = String(publicId ?? "").trim();
  if (normalizedPublicId.length > 0) return normalizedPublicId;
  return String(value ?? "").slice(0, 8);
}

export function parseTagsInput(value: string) {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(part);
    if (deduped.length >= 20) break;
  }

  return deduped;
}

export function formatTagsInput(tags: string[] | null | undefined) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return tags.join(", ");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const yyyy = parsed.getFullYear();
  const mm = pad(parsed.getMonth() + 1);
  const dd = pad(parsed.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

export function toDateTimeLocalValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "";
  const yyyy = parsed.getFullYear();
  const mm = pad(parsed.getMonth() + 1);
  const dd = pad(parsed.getDate());
  const hh = pad(parsed.getHours());
  const min = pad(parsed.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function toIsoFromDateInput(value: string | null | undefined, boundary: "start" | "end") {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const suffix = boundary === "start" ? "T00:00:00" : "T23:59:59";
  const parsed = new Date(`${trimmed}${suffix}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function toIsoFromDateTimeLocal(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

type QuoteEmailInput = {
  quoteId: string;
  quotePublicId?: string | null;
  customerName: string;
  customerEmail: string;
  startAt: string;
  endAt: string;
  pickupLocation: string;
  dropoffLocation: string;
  vehicleLabel: string;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  expiresAt?: string | null;
  openPath?: string;
};

export function buildQuoteEmailDraft(input: QuoteEmailInput) {
  const displayQuoteId = shortQuoteId(input.quoteId, input.quotePublicId);
  const subject = `Your Quote from ${siteContent.brand} (${displayQuoteId})`;
  const lines = [
    `Hello ${input.customerName || "Customer"},`,
    "",
    `Thank you for choosing ${siteContent.brand}. Here is your quote summary:`,
    `Quote ID: ${displayQuoteId}`,
    `Vehicle: ${input.vehicleLabel || "—"}`,
    `Pickup: ${fmtDateNoSeconds(input.startAt)} (${input.pickupLocation || "—"})`,
    `Dropoff: ${fmtDateNoSeconds(input.endAt)} (${input.dropoffLocation || "—"})`,
    `Total: ${formatJmd(input.totalCents)}`,
    `Deposit required: ${formatJmd(input.depositRequiredCents)}`,
    `Amount due now: ${formatJmd(input.amountDueCents)}`,
    input.expiresAt ? `Expires: ${fmtDateNoSeconds(input.expiresAt)}` : null,
    input.openPath ? `Open in admin: ${input.openPath}` : null,
    "",
    `Questions? Contact us at ${siteContent.email} or ${siteContent.phone}.`,
    "",
    `Best regards,`,
    `${siteContent.brand}`,
  ].filter(Boolean);

  const body = lines.join("\n");
  const href = `mailto:${encodeURIComponent(input.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return { subject, body, href };
}
