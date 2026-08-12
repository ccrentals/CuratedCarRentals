export type JmdAmountInput = number | string | null | undefined;

/**
 * Commercial booking/payment values are stored as JMD amounts at scale 1.
 * Legacy column and JSON names may end in `_cents`; do not divide those values by 100.
 */
export function readStoredJmdAmount(value: JmdAmountInput) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

/** Fleet finance, depreciation, and maintenance values use true minor units at scale 100. */
export function jmdMinorUnitsToAmount(value: JmdAmountInput) {
  return readStoredJmdAmount(value) / 100;
}

/** Convert a user-entered JMD amount into true minor units for fleet finance domains. */
export function jmdAmountToMinorUnits(value: JmdAmountInput) {
  return Math.round(readStoredJmdAmount(value) * 100);
}

export function formatJmd(amount: number) {
  return readStoredJmdAmount(amount).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPublicJmd(amount: number) {
  return readStoredJmdAmount(amount).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// For provider payloads/receipts: always send a plain decimal string.
// Note: our DB stores whole JMD dollars as integers (despite *_cents column names).
export function formatJmdDecimal(amount: number) {
  return readStoredJmdAmount(amount).toFixed(2);
}

export function formatJmdNumber(amount: JmdAmountInput) {
  return readStoredJmdAmount(amount).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatJmdFromMinorUnits(amountMinorUnits: JmdAmountInput) {
  return jmdMinorUnitsToAmount(amountMinorUnits).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatJmdDecimalFromMinorUnits(amountMinorUnits: JmdAmountInput) {
  return jmdMinorUnitsToAmount(amountMinorUnits).toFixed(2);
}

/** @deprecated Use formatJmdFromMinorUnits; `_cents` is ambiguous in this codebase. */
export function formatJmdFromCents(amountCents: number | null | undefined) {
  return formatJmdFromMinorUnits(amountCents);
}

/** @deprecated Use formatJmdDecimalFromMinorUnits; `_cents` is ambiguous in this codebase. */
export function formatJmdDecimalFromCents(amountCents: number | null | undefined) {
  return formatJmdDecimalFromMinorUnits(amountCents);
}

export function formatUsd(amount: number) {
  return Number(amount || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
