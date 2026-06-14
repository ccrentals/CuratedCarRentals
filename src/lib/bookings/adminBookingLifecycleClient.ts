import { ensureCsrfToken } from "@/lib/security/csrf-client";

export type AdminBookingLifecycleAction = "confirm" | "pickup" | "complete" | "archive";

export function getAdminBookingLifecycleEligibility(input: {
  bookingStatus?: string | null;
  isPaidInFull?: boolean;
  isPickupInspectionComplete?: boolean;
  isReturnInspectionComplete?: boolean;
}) {
  const normalizedStatus = input.bookingStatus?.trim().toUpperCase() ?? "";
  const canPickup =
    normalizedStatus === "CONFIRMED" &&
    Boolean(input.isPaidInFull) &&
    Boolean(input.isPickupInspectionComplete);
  const canComplete =
    normalizedStatus === "PICKED_UP" &&
    Boolean(input.isReturnInspectionComplete);

  const pickupDisabledReason = canPickup
    ? null
    : !input.isPickupInspectionComplete
      ? "Complete the pickup inspection before confirming pickup."
      : normalizedStatus !== "CONFIRMED"
        ? normalizedStatus === "PICKED_UP"
          ? "Pickup has already been confirmed."
          : "Confirm the booking before confirming pickup."
        : !input.isPaidInFull
          ? "Booking must be fully paid before pickup."
          : "Pickup cannot be confirmed yet.";
  const completeDisabledReason = canComplete
    ? null
    : normalizedStatus === "RETURNED"
      ? "Booking has already been completed."
      : normalizedStatus !== "PICKED_UP"
        ? "Confirm pickup before completing the booking."
        : "Complete the return inspection before completing the booking.";

  return {
    normalizedStatus,
    canPickup,
    canComplete,
    pickupDisabledReason,
    completeDisabledReason,
  };
}

export async function runAdminBookingLifecycleAction(input: {
  bookingId: string;
  action: AdminBookingLifecycleAction;
  archiveReason?: string | null;
}) {
  const csrfToken = await ensureCsrfToken();
  const response = await fetch(`/api/admin/bookings/${input.bookingId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken ?? "",
    },
    body: JSON.stringify(
      input.action === "archive"
        ? { action: input.action, reason: input.archiveReason }
        : { action: input.action },
    ),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    ok?: boolean;
  };

  return { response, data };
}
