function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatBookingStatusLabel(bookingStatus: string, paymentStatus?: string | null) {
  const normalizedBookingStatus = String(bookingStatus ?? "")
    .trim()
    .toUpperCase();
  const normalizedPaymentStatus = String(paymentStatus ?? "")
    .trim()
    .toUpperCase();

  if (!normalizedBookingStatus) return "Unknown";
  if (normalizedBookingStatus === "CONFIRMED" && normalizedPaymentStatus !== "PAID_IN_FULL") {
    return "Booked";
  }

  return toTitleCase(normalizedBookingStatus);
}
