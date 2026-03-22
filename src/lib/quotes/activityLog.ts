const TITLE_CASE_SPLITTER = /[_\s-]+/g;

const EVENT_TITLE_MAP: Record<string, string> = {
  STATUS_CHANGED: "Status updated",
  UPDATED: "Quote updated",
  CREATED: "Quote created",
  EMAILED: "Quote emailed",
  CONVERTED: "Converted to booking",
  PDF_GENERATED: "PDF generated",
};

const EVENT_ACTOR_LABEL_MAP: Record<string, string> = {
  STATUS_CHANGED: "Changed by:",
  UPDATED: "Updated by:",
  CREATED: "Created by:",
};

const SPECIAL_META_KEYS = {
  fromStatus: ["fromstatus", "from_status"],
  toStatus: ["tostatus", "to_status"],
  repriced: ["repriced", "price_recalculated"],
} as const;

function normalizeEventType(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeMetaKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TITLE_CASE_TOKEN_MAP: Record<string, string> = {
  api: "API",
  id: "ID",
  pdf: "PDF",
};

function titleCaseWords(value: string) {
  return value
    .split(TITLE_CASE_SPLITTER)
    .filter(Boolean)
    .map((segment) => {
      const normalized = segment.toLowerCase();
      if (TITLE_CASE_TOKEN_MAP[normalized]) return TITLE_CASE_TOKEN_MAP[normalized];
      return normalized[0]?.toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

function stringifyMetaKey(value: string) {
  return titleCaseWords(value);
}

function stringifyMetaDisplayValue(key: string, value: unknown): string {
  const text = stringifyMetaValue(value);
  if (normalizeMetaKey(key) === "source") {
    return titleCaseWords(text);
  }
  return text;
}

function stringifyMetaValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseBooleanFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  }
  return null;
}

function pickMetaValue(
  metaEntries: Array<[string, unknown]>,
  aliases: readonly string[],
  consumedKeys: Set<string>,
): unknown {
  for (const [key, value] of metaEntries) {
    if (!aliases.includes(normalizeMetaKey(key))) continue;
    consumedKeys.add(key);
    return value;
  }
  return undefined;
}

export function formatQuoteActivityTitle(eventType: string | null | undefined) {
  const normalized = normalizeEventType(eventType);
  if (!normalized) return "Event";
  if (EVENT_TITLE_MAP[normalized]) return EVENT_TITLE_MAP[normalized];
  return titleCaseWords(normalized);
}

export function formatQuoteActivityActorLabel(eventType: string | null | undefined) {
  const normalized = normalizeEventType(eventType);
  if (!normalized) return "Actor:";
  return EVENT_ACTOR_LABEL_MAP[normalized] ?? "Actor:";
}

export function formatQuoteActivityMeta(meta: Record<string, unknown> | null | undefined) {
  const metaEntries = Object.entries(meta ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (metaEntries.length === 0) return null;

  const consumedKeys = new Set<string>();
  const fragments: string[] = [];

  const fromStatus = pickMetaValue(metaEntries, SPECIAL_META_KEYS.fromStatus, consumedKeys);
  const toStatus = pickMetaValue(metaEntries, SPECIAL_META_KEYS.toStatus, consumedKeys);
  if (fromStatus !== undefined || toStatus !== undefined) {
    const fromLabel = stringifyMetaValue(fromStatus ?? "—");
    const toLabel = stringifyMetaValue(toStatus ?? "—");
    fragments.push(`From: ${fromLabel}  To: ${toLabel}`);
  }

  const repriced = pickMetaValue(metaEntries, SPECIAL_META_KEYS.repriced, consumedKeys);
  if (repriced !== undefined) {
    const boolValue = parseBooleanFlag(repriced);
    if (boolValue === null) {
      fragments.push(`Price recalculated: ${stringifyMetaValue(repriced)}`);
    } else {
      fragments.push(`Price recalculated: ${boolValue ? "Yes" : "No"}`);
    }
  }

  for (const [key, value] of metaEntries) {
    if (consumedKeys.has(key)) continue;
    fragments.push(`${stringifyMetaKey(key)}: ${stringifyMetaDisplayValue(key, value)}`);
  }

  return fragments.length > 0 ? fragments.join(" · ") : null;
}
