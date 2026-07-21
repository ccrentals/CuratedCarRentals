import { ApiError } from "@/services/api";

export type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;

export type AdminDashboardData = {
  generatedAt: string;
  metrics: {
    totalBookings: number;
    pendingPayment: number;
    confirmedBookings: number;
    totalVehicles: number;
    availableVehicles: number;
    attentionVehicles: number;
  };
  recentBookings: {
    id: string;
    publicId: string;
    customerName: string;
    vehicleLabel: string;
    startDateIso: string;
    endDateIso: string;
    status: string;
    statusLabel: string;
    substatusIndicators: { key: string; variant: string; message: string; priority: number }[];
  }[];
  recentVehicles: {
    id: string;
    publicId: string;
    label: string;
    status: string;
  }[];
};

export type AdminBookingListItem = {
  id: string;
  publicId: string;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  startDateIso: string;
  endDateIso: string;
  status: string;
  statusLabel: string;
  substatusIndicators: { key: string; variant: string; message: string; priority: number }[];
};

export type AdminBookingsPage = {
  bookings: AdminBookingListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  archiveNotConfigured: boolean;
  limit: number;
};

export type AdminBookingDetail = {
  booking: {
    id: string;
    public_id: string | null;
    start_date: string;
    end_date: string;
    pickup_location: string;
    status: string;
    payment_option: string;
    payment_status: string;
    amount_paid: number;
    balance_due: number;
    non_blocking: boolean;
    overridden_by_booking_id: string | null;
  };
  customer: { full_name: string; email: string; phone: string };
  vehicle: { make: string; model: string; year: number };
  payments: { id: string; public_id: string; provider: string; status: string; deposit_amount_cents: number; currency: string; created_at: string }[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readAdminJson<T>(request: AdminRequest, path: string, init?: RequestInit) {
  const response = await request(path, init);
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = isObject(data) && typeof data.error === "string"
      ? data.error
      : "The admin service could not complete this request.";
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export async function fetchAdminDashboard(request: AdminRequest) {
  const data = await readAdminJson<AdminDashboardData & { ok?: boolean }>(request, "/api/admin/dashboard", {
    cache: "no-store",
  });
  if (!isObject(data.metrics) || !Array.isArray(data.recentBookings) || !Array.isArray(data.recentVehicles)) {
    throw new ApiError("The dashboard returned an invalid response.", 502);
  }
  return data;
}

export async function fetchAdminBookings(request: AdminRequest, input: {
  q?: string;
  status?: string;
  scope?: string;
  cursor?: string | null;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.scope && input.scope !== "all") params.set("scope", input.scope);
  if (input.cursor) params.set("cursor", input.cursor);
  params.set("limit", String(input.limit ?? 20));
  const data = await readAdminJson<AdminBookingsPage>(request, `/api/admin/bookings?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.bookings) || typeof data.totalCount !== "number") {
    throw new ApiError("The bookings service returned an invalid response.", 502);
  }
  return data;
}

export async function fetchAdminBooking(request: AdminRequest, bookingId: string) {
  const data = await readAdminJson<AdminBookingDetail>(request, `/api/admin/bookings/${encodeURIComponent(bookingId)}`, { cache: "no-store" });
  if (!isObject(data.booking) || !isObject(data.customer) || !isObject(data.vehicle) || !Array.isArray(data.payments)) {
    throw new ApiError("The booking service returned an invalid response.", 502);
  }
  return data;
}

export async function updateAdminBookingStatus(request: AdminRequest, bookingId: string, action: "confirm" | "pickup" | "complete") {
  return readAdminJson<{ ok: true; message?: string }>(request, `/api/admin/bookings/${encodeURIComponent(bookingId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  });
}
