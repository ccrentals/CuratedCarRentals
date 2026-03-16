export const CALENDAR_BOOKING_STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending_payment" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Returned", value: "returned" },
] as const;

export type CalendarVehicleOption = {
  id: string;
  make: string;
  model: string;
};

export const CALENDAR_EXCLUDED_BOOKING_STATUSES = ["CANCELLED", "OVERRIDDEN"] as const;

type CalendarBookingStatusOption = (typeof CALENDAR_BOOKING_STATUS_OPTIONS)[number]["value"];
type CalendarBookingStatusFilter = Exclude<CalendarBookingStatusOption, "all">;

const CALENDAR_STATUS_PARAM_MAP: Record<string, CalendarBookingStatusFilter> = {
  pending_payment: "pending_payment",
  pending: "pending_payment",
  confirmed: "confirmed",
  returned: "returned",
};

const CALENDAR_STATUS_SQL_MAP: Record<CalendarBookingStatusFilter, string> = {
  pending_payment: "PENDING_PAYMENT",
  confirmed: "CONFIRMED",
  returned: "RETURNED",
};

export function normalizeCalendarBookingStatusParam(
  statusParam?: string | null,
): CalendarBookingStatusFilter | undefined {
  if (!statusParam) return undefined;
  const normalized = statusParam.trim().toLowerCase();
  if (!normalized || normalized === "all") return undefined;
  return CALENDAR_STATUS_PARAM_MAP[normalized];
}

export function buildCalendarBookingStatusClauses(input: {
  statusParam?: string | null;
  paramStartIndex: number;
  bookingAlias?: string;
}) {
  const alias = input.bookingAlias ?? "b";
  const selectedStatus = normalizeCalendarBookingStatusParam(input.statusParam);
  const clauses = [
    `${alias}.status not in ('${CALENDAR_EXCLUDED_BOOKING_STATUSES[0]}', '${CALENDAR_EXCLUDED_BOOKING_STATUSES[1]}')`,
  ];
  const values: string[] = [];
  let nextParamIndex = input.paramStartIndex;

  if (selectedStatus) {
    clauses.push(`${alias}.status = $${nextParamIndex}`);
    values.push(CALENDAR_STATUS_SQL_MAP[selectedStatus]);
    nextParamIndex += 1;
  }

  return {
    clauses,
    values,
    nextParamIndex,
    selectedStatus: (selectedStatus ?? "all") as CalendarBookingStatusOption,
  };
}

export function sanitizeCalendarVehicleId(
  vehicleId: string | undefined,
  vehicles: CalendarVehicleOption[],
): string | undefined {
  if (!vehicleId) return undefined;
  return vehicles.some((vehicle) => vehicle.id === vehicleId) ? vehicleId : undefined;
}
