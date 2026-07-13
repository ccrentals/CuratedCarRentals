type PricingSummary = {
  insuranceSelected: boolean;
  insurancePricePerDay: number;
  insuranceTotal: number;
  promoCode: string | null;
  promoDiscount: number;
  total: number;
  netPaidToDate: number;
  balanceDue: number;
  refundRequired: boolean;
};

type ChangeValue = string | number | null | undefined;

function formatJmd(value: number) {
  return `JMD ${new Intl.NumberFormat("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(value ?? 0)))}`;
}

function normalize(value: ChangeValue) {
  return String(value ?? "").trim();
}

function addChange(lines: string[], label: string, previous: ChangeValue, next: ChangeValue) {
  const before = normalize(previous);
  const after = normalize(next);
  if (before === after) return;
  lines.push(`${label}: ${before || "Not set"} -> ${after || "Not set"}`);
}

function formatInsurance(summary: PricingSummary) {
  if (!summary.insuranceSelected) return "Not selected";
  return `${formatJmd(summary.insurancePricePerDay)}/day (${formatJmd(summary.insuranceTotal)} total)`;
}

function formatPromo(summary: PricingSummary) {
  if (!summary.promoCode) return "Not applied";
  return `${summary.promoCode} (${formatJmd(summary.promoDiscount)} discount)`;
}

export function appendBookingItineraryChangeNote(
  pricing: Record<string, unknown> | null | undefined,
  input: {
    previousVehicle: string;
    nextVehicle: string;
    previousPickupDateTime: string;
    nextPickupDateTime: string;
    previousDropoffDateTime: string;
    nextDropoffDateTime: string;
    previousPickupLocation: string;
    nextPickupLocation: string;
    previousDropoffLocation: string;
    nextDropoffLocation: string;
    previousCustomerName: string;
    nextCustomerName: string;
    previousCustomerEmail: string;
    nextCustomerEmail: string;
    previousCustomerPhone: string;
    nextCustomerPhone: string;
    previousSummary: PricingSummary;
    nextSummary: PricingSummary;
    userId: string | null;
    createdAt?: string;
  },
) {
  const basePricing = pricing && typeof pricing === "object" ? { ...pricing } : {};
  const lines: string[] = [];
  addChange(lines, "Vehicle", input.previousVehicle, input.nextVehicle);
  addChange(lines, "Pickup", input.previousPickupDateTime, input.nextPickupDateTime);
  addChange(lines, "Drop-off", input.previousDropoffDateTime, input.nextDropoffDateTime);
  addChange(lines, "Pickup location", input.previousPickupLocation, input.nextPickupLocation);
  addChange(lines, "Drop-off location", input.previousDropoffLocation, input.nextDropoffLocation);
  addChange(lines, "Customer name", input.previousCustomerName, input.nextCustomerName);
  addChange(lines, "Customer email", input.previousCustomerEmail, input.nextCustomerEmail);
  addChange(lines, "Customer phone", input.previousCustomerPhone, input.nextCustomerPhone);
  addChange(lines, "Insurance", formatInsurance(input.previousSummary), formatInsurance(input.nextSummary));
  addChange(lines, "Promo", formatPromo(input.previousSummary), formatPromo(input.nextSummary));
  addChange(lines, "Booking total", formatJmd(input.previousSummary.total), formatJmd(input.nextSummary.total));
  addChange(lines, "Balance due", formatJmd(input.previousSummary.balanceDue), formatJmd(input.nextSummary.balanceDue));

  if (input.nextSummary.refundRequired) {
    lines.push(
      `Refund review required: paid ${formatJmd(input.nextSummary.netPaidToDate)}, ` +
        `new total ${formatJmd(input.nextSummary.total)}, ` +
        `overpayment ${formatJmd(input.nextSummary.netPaidToDate - input.nextSummary.total)}`,
    );
  }

  if (lines.length === 0) return basePricing;
  const existingNotes = Array.isArray((basePricing as { admin_notes?: unknown }).admin_notes)
    ? ((basePricing as { admin_notes: unknown[] }).admin_notes as unknown[])
    : [];
  return {
    ...basePricing,
    admin_notes: [
      ...existingNotes,
      {
        note_id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : undefined,
        message: ["Booking details updated", ...lines].join(" | "),
        created_at: input.createdAt ?? new Date().toISOString(),
        user_id: input.userId,
        system_generated: true,
        system_type: "BOOKING_ITINERARY_UPDATED",
      },
    ],
  };
}
