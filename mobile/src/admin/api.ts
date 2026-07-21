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

export type AdminQuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "EXPIRED" | "CONVERTED" | "CANCELLED";

export type AdminQuoteListItem = {
  id: string;
  publicId: string;
  createdAt: string;
  status: AdminQuoteStatus;
  expiresAt: string | null;
  customerFullName: string;
  customerEmail: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  pickupLocationText: string;
  dropoffLocationText: string;
  vehicleId: string | null;
  vehicleLabel: string;
  vehicleClass: string | null;
  baseTotalCents: number;
  insuranceTotalCents: number;
  discountTotalCents: number;
  subtotalCents: number;
  totalCents: number;
  depositRequiredCents: number;
  amountDueCents: number;
  promoCode: string | null;
  insuranceEnabled: boolean;
  tags: string[];
  comments: string | null;
  commissionPartnerName: string | null;
  clientPaysAtPartner: boolean;
  rackPriceCents: number | null;
  lastEmailedAt: string | null;
};

export type AdminQuoteDetail = AdminQuoteListItem & {
  updatedAt: string;
  pricingJson: Record<string, unknown>;
  pickupLocationId: string | null;
  dropoffLocationId: string | null;
  insurancePlanId: string | null;
  createdByAdminUserId: string | null;
  lastEmailedTo: string | null;
  convertedBookingId: string | null;
};

export type AdminQuotesPage = {
  items: AdminQuoteListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  limit: number;
};

export type AdminCustomerListItem = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  created_at: string;
  last_booked_at: string | null;
  total_bookings: number;
  total_spend: number;
};

export type AdminCustomerDetail = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  birthday: string | null;
  drivers_license_number: string | null;
  is_blocked: boolean | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  blocked_reason: string | null;
  legal_id_type: string | null;
  legal_id_number: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  last_booked_at: string | null;
};

export type AdminCustomerBooking = {
  id: string;
  publicId: string;
  vehicleLabel: string;
  startDateValue: string;
  startDateLabel: string;
  endDateValue: string;
  endDateLabel: string;
  status: string;
  statusLabel: string;
  totalAmount: number;
  totalLabel: string;
  balanceAmount: number;
  balanceLabel: string;
  createdAtValue: string;
  createdAtLabel: string;
};

export type AdminCustomerBookingsPage = {
  bookings: AdminCustomerBooking[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  limit: number;
};

export type AdminCustomerInput = {
  fullName: string;
  email: string;
  phone: string;
  address?: string;
  notes?: string;
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

export async function fetchAdminQuotes(request: AdminRequest, input: {
  q?: string;
  status?: string;
  cursor?: string | null;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.cursor) params.set("cursor", input.cursor);
  params.set("sortBy", "created");
  params.set("sortDir", "desc");
  params.set("limit", String(input.limit ?? 20));
  const data = await readAdminJson<AdminQuotesPage>(request, `/api/admin/quotes?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.items) || typeof data.totalCount !== "number") {
    throw new ApiError("The quotes service returned an invalid response.", 502);
  }
  return data;
}

export async function fetchAdminQuote(request: AdminRequest, quoteId: string) {
  const data = await readAdminJson<{ ok: true; item: AdminQuoteDetail }>(request, `/api/admin/quotes/${encodeURIComponent(quoteId)}`, { cache: "no-store" });
  if (!isObject(data.item) || !Array.isArray(data.item.tags)) {
    throw new ApiError("The quote service returned an invalid response.", 502);
  }
  return data.item;
}

export async function updateAdminQuoteStatus(request: AdminRequest, quoteId: string, status: AdminQuoteStatus) {
  const data = await readAdminJson<{ ok: true; item: AdminQuoteDetail }>(request, `/api/admin/quotes/${encodeURIComponent(quoteId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return data.item;
}

export async function emailAdminQuote(request: AdminRequest, quoteId: string, toEmail: string) {
  return readAdminJson<{ ok: true; toEmail: string; subject: string }>(request, `/api/admin/quotes/${encodeURIComponent(quoteId)}/email`, {
    method: "POST",
    body: JSON.stringify({ toEmail }),
  });
}

export async function convertAdminQuote(request: AdminRequest, quoteId: string) {
  return readAdminJson<{ ok: true; bookingId: string; alreadyConverted: boolean }>(request, `/api/admin/quotes/${encodeURIComponent(quoteId)}/convert-to-booking`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchAdminCustomers(request: AdminRequest, input: {
  q?: string;
  sortBy?: "customer" | "bookings" | "totalSpend" | "lastBooked" | "created";
  sortDir?: "asc" | "desc";
}) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  params.set("sortBy", input.sortBy ?? "lastBooked");
  params.set("sortDir", input.sortDir ?? "desc");
  const data = await readAdminJson<{ customers: AdminCustomerListItem[] }>(request, `/api/admin/customers?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.customers)) throw new ApiError("The customers service returned an invalid response.", 502);
  return data.customers;
}

export async function fetchAdminCustomer(request: AdminRequest, customerId: string) {
  const data = await readAdminJson<{ customer: AdminCustomerDetail }>(request, `/api/admin/customers/${encodeURIComponent(customerId)}`, { cache: "no-store" });
  if (!isObject(data.customer) || typeof data.customer.id !== "string") throw new ApiError("The customer service returned an invalid response.", 502);
  return data.customer;
}

export async function fetchAdminCustomerBookings(request: AdminRequest, customerId: string, cursor?: string | null) {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const data = await readAdminJson<AdminCustomerBookingsPage>(request, `/api/admin/customers/${encodeURIComponent(customerId)}/bookings?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.bookings) || typeof data.totalCount !== "number") throw new ApiError("The customer history service returned an invalid response.", 502);
  return data;
}

export async function createAdminCustomer(request: AdminRequest, input: AdminCustomerInput & { firstName: string; lastName: string }) {
  const data = await readAdminJson<{ customer: Pick<AdminCustomerDetail, "id" | "full_name" | "email" | "phone"> }>(request, "/api/admin/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isObject(data.customer) || typeof data.customer.id !== "string") throw new ApiError("The customer service returned an invalid response.", 502);
  return data.customer;
}

export async function updateAdminCustomer(request: AdminRequest, customerId: string, input: AdminCustomerInput) {
  return readAdminJson<{ ok: true; synchronizedBookingCount: number }>(request, `/api/admin/customers/${encodeURIComponent(customerId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function setAdminCustomerBlocked(request: AdminRequest, customerId: string, blocked: boolean, blockReason?: string) {
  return readAdminJson<{ ok: true; blocked: boolean }>(request, `/api/admin/customers/${encodeURIComponent(customerId)}`, {
    method: "PATCH",
    body: JSON.stringify({ setBlocked: blocked, blockReason: blocked ? blockReason?.trim() || "Blocked by staff in mobile admin" : null }),
  });
}
