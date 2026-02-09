export function formatJmd(amount: number) {
  return Number(amount || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// For provider payloads/receipts: always send a plain decimal string.
// Note: our DB stores whole JMD dollars as integers (despite *_cents column names).
export function formatJmdDecimal(amount: number) {
  return Number(amount || 0).toFixed(2);
}
