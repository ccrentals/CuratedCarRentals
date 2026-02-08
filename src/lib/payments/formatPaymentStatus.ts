type FormatPaymentStatusOptions = {
  paymentType?: string | null;
  isPaidInFull?: boolean;
};

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatPaymentStatus(
  status: unknown,
  options: FormatPaymentStatusOptions = {},
) {
  const normalized = String(status ?? "").trim().toUpperCase();
  const paymentType =
    typeof options.paymentType === "string" ? options.paymentType.trim().toLowerCase() : "";

  if (options.isPaidInFull) return "Payment Complete";
  if (normalized === "PAID_IN_FULL") return "Payment Complete";

  // We store successful payments as `DEPOSIT_PAID` in the DB, but distinguish meaning via `payment_type`.
  if (normalized === "DEPOSIT_PAID" && paymentType === "balance") return "Payment Complete";
  if (normalized === "DEPOSIT_PAID") return "Deposit Paid";

  if (!normalized) return "";
  return titleCase(normalized.replace(/_/g, " ").toLowerCase());
}

