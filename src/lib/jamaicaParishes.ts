export const JAMAICA_PARISHES = [
  "Kingston",
  "St. Andrew",
  "St. Thomas",
  "Portland",
  "St. Mary",
  "St. Ann",
  "Trelawny",
  "St. James",
  "Hanover",
  "Westmoreland",
  "St. Elizabeth",
  "Manchester",
  "Clarendon",
  "St. Catherine",
] as const;

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function canonicalizeParish(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[.]+/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeJamaicaParish(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = canonicalizeParish(value);
  if (!normalized) return null;

  return JAMAICA_PARISHES.find((parish) => canonicalizeParish(parish) === normalized) ?? null;
}

export function isJamaicaParish(value: unknown) {
  return normalizeJamaicaParish(value) !== null;
}

export function normalizeCountryName(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function isJamaicaCountry(value: unknown) {
  const normalized = normalizeCountryName(value);
  return normalized !== null && normalized.toLowerCase() === "jamaica";
}

export function normalizeRegionForCountry(region: unknown, country: unknown) {
  const normalizedRegion = normalizeText(region);
  if (!normalizedRegion) return null;
  if (isJamaicaCountry(country)) {
    return normalizeJamaicaParish(normalizedRegion) ?? normalizedRegion;
  }
  return normalizedRegion;
}

export function resolveStoredRegionCountry(state: unknown, country: unknown) {
  const normalizedState = normalizeText(state);
  const normalizedCountry = normalizeCountryName(country);
  const legacyParish = normalizedState ? null : normalizeJamaicaParish(normalizedCountry ?? "");

  return {
    region: normalizedState || legacyParish || null,
    country: legacyParish ? "Jamaica" : normalizedCountry,
  };
}
