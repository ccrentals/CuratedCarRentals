export const LEGAL_ID_TYPES = [
  "TRN",
  "PASSPORT",
  "DRIVERS_LICENSE",
  "NATIONAL_ID",
  "OTHER",
] as const;

export type LegalIdType = (typeof LEGAL_ID_TYPES)[number];

const LEGAL_ID_LABELS: Record<LegalIdType, string> = {
  TRN: "TRN",
  PASSPORT: "Passport",
  DRIVERS_LICENSE: "Driver's License",
  NATIONAL_ID: "National ID",
  OTHER: "Other",
};

export function normalizeLegalIdType(value: unknown): LegalIdType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  return LEGAL_ID_TYPES.includes(normalized as LegalIdType)
    ? (normalized as LegalIdType)
    : null;
}

export function formatLegalIdTypeLabel(value: string | null | undefined) {
  const normalized = normalizeLegalIdType(value);
  if (!normalized) return "Unknown ID";
  return LEGAL_ID_LABELS[normalized];
}

