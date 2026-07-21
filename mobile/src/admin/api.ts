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

export type AdminVehicleListItem = {
  id: string;
  public_id: string;
  make: string;
  model: string;
  year: number;
  seat_count: number | null;
  daily_rate_cents: number;
  deposit_cents: number;
  status: string;
  derived_status: string;
  created_at: string;
  deleted_at: string | null;
};

export type AdminVehicleDetail = Omit<AdminVehicleListItem, "derived_status" | "deleted_at"> & {
  updated_at: string;
};

export type AdminVehicleProfile = {
  vehicle_id: string;
  vin: string | null;
  license_plate: string | null;
  vehicle_type: string | null;
  vehicle_class: string | null;
  year: number | null;
  color: string | null;
  seat_count: number | null;
  current_location_label: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  fuel_level_value: number | null;
  available_from: string | null;
  available_until: string | null;
  entry_date: string | null;
  exit_date: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminVehicleHistoryItem = {
  id: string;
  publicId: string | null;
  eventType: "BOOKING" | "BLOCKOUT" | "MAINTENANCE";
  customerName: string | null;
  customerEmail: string | null;
  pickupAt: string;
  returnAt: string;
  status: string;
  totalCents: number | null;
  depositCents: number | null;
  source: string;
  activeNow: boolean;
  impactsAvailability: boolean;
  actionHref: string;
  createdAt: string;
};

export type AdminVehicleHistory = {
  rows: AdminVehicleHistoryItem[];
  summary: { upcomingCount: number; onRentCount: number; activeCount: number; completedCount: number; cancelledCount: number; activeBlockoutCount: number };
  paging: { limit: number; offset: number; total: number };
  statuses: string[];
};

export type AdminVehicleNote = {
  id: string;
  vehicleId: string;
  noteText: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AdminMessageStatus = "NEW" | "READ" | "ARCHIVED";
export type AdminMessageAction = "MARK_READ" | "MARK_NEW" | "ARCHIVE" | "UNARCHIVE" | "DELETE_PERMANENT";

export type AdminMessageListItem = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  status: AdminMessageStatus;
  visibleStatus: "NEW" | "READ" | "TRASH";
  statusLabel: string;
  snippet: string;
  source: string;
  sourceKey: string;
  sourceLabel: string;
  subject: string;
  messageType: string;
  priority: string;
  isTrashed: boolean;
  displayName: string;
  displayEmail: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  relatedEntityPublicId: string | null;
  relatedEntityLabel: string | null;
  relatedEntityHref: string | null;
};

export type AdminMessageDetail = AdminMessageListItem & {
  message: string;
  readAt: string | null;
  readByUserId: string | null;
};

export type AdminMessagesPage = {
  items: AdminMessageListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  limit: number;
};

export type AdminReportsPayload = {
  filters: { snapshotDate: string; rangeFrom: string; rangeTo: string; vehicleId: string; pickupLocationType: string; dropoffLocationType: string; locationLabel: string; revenueGranularity: "day" | "week" | "month" };
  generatedAt: string;
  sectionMeta: Record<string, { mode: "operational" | "historical"; dateBasisLabel: string; supportsExport: boolean; warnings: string[] }>;
  revenue: { granularity: string; totals: { grossRevenue: number; refunds: number; netRevenue: number; paymentCount: number }; points: { periodStart: string; periodLabel: string; grossRevenue: number; refunds: number; netRevenue: number; paymentCount: number }[] };
  vehicleProfitability: { totals: { vehicleCount: number; grossRevenue: number; refunds: number; maintenanceCost: number; netProfit: number }; includesMaintenanceData: boolean; rows: { vehicleId: string; vehicleLabel: string; bookingCount: number; grossRevenue: number; refunds: number; maintenanceCost: number; netProfit: number; marginPercent: number }[] };
  utilization: { rangeDays: number; includesBlockouts: boolean; rows: { vehicleId: string; vehicleLabel: string; bookedDays: number; blockoutDays: number; availableDays: number; utilizationPercent: number }[] };
  outstandingBalances: { totals: { totalOutstandingAmount: number; outstandingCount: number }; rows: { bookingId: string; bookingDbId: string; customerName: string; vehicleLabel: string; pickupDate: string; returnDate: string; status: string; paymentOption: string; paymentStatus: string; isNonBlocking: boolean; total: number; amountPaid: number; balanceDue: number; daysFromPickup: number }[] };
  agingReceivables: { totals: { totalOutstandingAmount: number; outstandingCount: number; overdueAmount: number; overdueCount: number }; buckets: { label: string; count: number; amount: number }[]; rows: { bookingId: string; bookingDbId: string; customerName: string; vehicleLabel: string; pickupDate: string; returnDate: string; balanceDue: number; daysPastDue: number; bucket: string }[] };
  customerCohort: { summary: { totalCustomers: number; newCustomers: number; repeatCustomers: number; repeatRate: number | null }; rows: { cohortMonth: string; cohortLabel: string; customerCount: number; bookingCount: number; revenue: number }[] };
  locationPerformance: { totals: { bookingCount: number; revenue: number; amountPaid: number; outstanding: number; cancellationCount: number }; rows: { locationLabel: string; pickupLabel: string; dropoffLabel: string; pickupType: string; dropoffType: string; bookingCount: number; revenue: number; amountPaid: number; outstanding: number; cancellationCount: number }[] };
  funnel: { counts: { pendingPayment: number; confirmedActive: number; completedReturned: number; cancelled: number; overridden: number; totalCreated: number }; conversion: { pendingToConfirmed: number | null; confirmedToCompleted: number | null; cancellationRate: number | null } };
  upcoming: { pickups: AdminReportUpcomingItem[]; returns: AdminReportUpcomingItem[] };
  cancellationRefundImpact: { summary: { cancelledCount: number; refundCount: number; refundTotal: number; grossPayments: number; netImpact: number }; breakdown: { periodStart: string; periodLabel: string; cancellations: number; refundTotal: number }[]; cancellations: unknown[]; refunds: unknown[]; excludedUnknownTimestampCount: number };
};

export type AdminReportUpcomingItem = {
  bookingId: string;
  bookingDbId: string;
  customerName: string;
  vehicleLabel: string;
  status: string;
  paymentStatus: string;
  paymentOption: string;
  isNonBlocking: boolean;
  pickupDate: string;
  returnDate: string;
  eventDate: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
};

export type AdminUserListItem = {
  id: string;
  public_id: string | null;
  email: string;
  username: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean | null;
  lifecycle_state: string | null;
  deactivated_at: string | null;
  locked_at: string | null;
  created_at: string;
  last_login_at: string | null;
};

export type AdminUserAction = "update_profile" | "set_role" | "resend_invite" | "unlock" | "lock" | "reset_password" | "deactivate" | "reactivate" | "delete_user";

export type AdminSettings = {
  authLoginMethod: "clerk" | "legacy";
  blockoutSupersedesBookings: boolean;
  requireRestoreReason: boolean;
  sendPickupReminder: boolean;
  sendDropoffReminder: boolean;
  sendLateDropoffAlert: boolean;
  dayViewBookingLimit: number | "all";
  contactNotificationEmails: string;
  contactNotifyCooldownMinutes: number;
  primaryAdminUserId: string | null;
  primaryDeveloperUserId: string | null;
  defaultOperationalNotificationEmail: string;
  additionalOperationalNotificationEmails: string[];
  sendVehicleInspectionWarningEmails: boolean;
  vehicleDocumentFolders: string[];
  vehicleDocumentTypeOptions: string[];
  vehicleChecklistTemplates: {
    key: string;
    label: string;
    folder: string;
    required: boolean;
    allowNotRequired: boolean;
    expiryRequired: boolean;
    expiryWarningDays: number | null;
    isActive: boolean;
  }[];
  vehicleChecklistTemplateItems: string[];
  maintenanceRemindersEnabled: boolean;
  maintenanceReminderLeadDays: number;
  maintenanceDueSoonDays: number;
  maintenanceDueSoonKm: number;
  maintenanceCategories: string[];
  maintenancePriorities: string[];
  depreciationDefaultMethod: "STRAIGHT_LINE";
  depreciationDefaultUsefulLifeMonths: number;
  depreciationDefaultResidualPercent: number;
  bookingMinimumRentalDays: { globalDefaultDays: number };
  bookingVehicleSecurityDeposits: { vehicleDepositsJmd: Record<string, number | null> };
};

export type AdminSettingsFieldErrors = Partial<Record<keyof AdminSettings | "bookingMinimumRentalDays" | "bookingVehicleSecurityDeposits", string>>;

export type AdminSettingsOwnershipOption = {
  id: string;
  email: string | null;
  fullName: string | null;
  username: string | null;
  role: string | null;
  roleLabel: string;
  label: string;
};

export type AdminSettingsOwnershipResolution = {
  userId: string | null;
  status: "missing" | "valid" | "not_found" | "inactive" | "wrong_role";
  label: string;
  message: string;
};

export type AdminSettingsPayload = {
  settings: AdminSettings;
  ownership: {
    primaryAdmin: AdminSettingsOwnershipResolution;
    primaryDeveloper: AdminSettingsOwnershipResolution;
    primaryAdminOptions: AdminSettingsOwnershipOption[];
    primaryDeveloperOptions: AdminSettingsOwnershipOption[];
  };
  operationalRouting: {
    configuredRecipients: string[];
    effectiveRecipients: string[];
    recipients: { email: string; source: string; label: string }[];
    hasConfiguredRecipients: boolean;
    usesFallback: boolean;
    warnings: string[];
  };
  configurationHealth?: { status: "ready" | "needs-review"; warnings: string[] };
  updatedAt: string | null;
  updatedByEmail: string | null;
};

export type AdminCalendarPayload = {
  view: "week" | "month";
  baseDate: string;
  rangeStart: string;
  rangeEnd: string;
  days: string[];
  selectedVehicleId: string | null;
  selectedStatus: "all" | "pending_payment" | "confirmed" | "returned";
  dayViewBookingLimit: number | "all";
  vehicles: { id: string; make: string; model: string }[];
  bookings: {
    id: string;
    public_id: string | null;
    status: string;
    archived_at: string | null;
    start_at: string | null;
    end_at: string | null;
    start_date: string;
    end_date: string;
    created_at: string;
    pickup_location: string;
    customer_name: string;
    customer_email: string;
    vehicle_id: string;
    vehicle_make: string;
    vehicle_model: string;
  }[];
  blockouts: {
    id: string;
    vehicle_id: string;
    start_at: string;
    end_at: string;
    reason: string;
    notes: string | null;
    vehicle_make: string;
    vehicle_model: string;
  }[];
  warnings: string[];
};

export type AdminPaymentItem = {
  id: string;
  publicId: string;
  bookingId: string;
  bookingPublicId: string | null;
  provider: string;
  providerLabel: string;
  status: string;
  statusLabel: string;
  paymentType: string;
  amount: number;
  currency: string;
  providerReference: string | null;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedReason: string | null;
  isRefunded: boolean;
  customerName: string;
  customerEmail: string;
  vehicleLabel: string;
  error: { title: string; detail: string } | null;
};

export type AdminPaymentsPage = {
  items: AdminPaymentItem[];
  summary: {
    total_count: number;
    collected_amount: number;
    refund_amount: number;
    net_amount: number;
    successful_count: number;
    attention_count: number;
  };
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  requireRestoreReason: boolean;
  filters: { q: string; type: string; state: string; provider: string };
};

export type AdminMaintenanceItem = {
  id: string;
  vehicleId: string;
  vehiclePublicId: string;
  vehicleLabel: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  category: string;
  title: string;
  scheduledDate: string | null;
  serviceDate: string | null;
  nextDueDate: string | null;
  dueState: "OVERDUE" | "DUE_SOON" | "UPCOMING" | "COMPLETED" | "CANCELLED";
  totalCostCents: number;
  priority: string;
  currentOdometerKm: number | null;
};

export type AdminPromoState = "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "LIMIT_REACHED";

export type AdminPromoItem = {
  id: string;
  public_id: string;
  code: string;
  is_active: boolean;
  discount_type: "PERCENT" | "FIXED";
  apply_scope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discount_value: number;
  min_subtotal_cents: number | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  start_at: string | null;
  end_at: string | null;
  allowed_vehicle_ids_json: string[];
  excluded_vehicle_ids_json: string[];
  blackout_dates_json: string[];
  created_at: string;
  updated_at: string;
  current_redemption_count: number;
  remaining_redemptions: number | null;
  admin_state: AdminPromoState;
};

export type AdminPromosPage = {
  promos: AdminPromoItem[];
  totalCount: number;
  page: number;
  totalPages: number;
  rowsPerPage: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

export type AdminPromoActivity = {
  id: string;
  booking_id: string;
  booking_public_id: string | null;
  customer_email: string | null;
  discount_amount_cents: number;
  event_type: "REDEEMED" | "REVERSED";
  event_at: string;
  created_at: string;
  is_reconstructed: boolean;
  timestamp_source: string | null;
};

export type AdminPromoDetail = {
  promo: AdminPromoItem;
  summary: {
    currentCount: number;
    remaining: number | null;
    status: AdminPromoState;
    redeemedEvents: number;
    reversedEvents: number;
    netCounted: number;
    totalDiscountRedeemed: number;
    totalDiscountReversed: number;
  };
  historyCoverage: string;
  historyCoverageStartedAt: string | null;
  hasReconstructedHistory: boolean;
  activity: {
    rows: AdminPromoActivity[];
    page: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
    from: number;
    to: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
};

export type AdminPromoInput = {
  code: string;
  isActive: boolean;
  discountType: "PERCENT" | "FIXED";
  applyScope: "OVERALL_TOTAL" | "DAYS_TOTAL";
  discountValue: number;
  minSubtotalCents: number | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  startAt: string | null;
  endAt: string | null;
  allowedVehicleIds: string[];
  excludedVehicleIds: string[];
  blackoutDates: string[];
};

export type AdminEmailListItem = {
  id: string;
  kind: "dispatch" | "quote_legacy" | "notification_dispatch_legacy";
  rawId: string;
  status: string;
  sentAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string | null;
  emailType: string;
  entityType: string | null;
  entityId: string | null;
  entityPublicId: string | null;
  triggerSource: string | null;
  relatedTransactionType: string | null;
  relatedTransactionId: string | null;
  providerMessageId: string | null;
  triggeredByUserId: string | null;
  triggeredByName: string | null;
  lastError: string | null;
  manualResendAllowed: boolean;
};

export type AdminEmailsPage = {
  items: AdminEmailListItem[];
  totalCount: number;
  page: number;
  rowsPerPage: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  from: number;
  to: number;
  summary: { total: number; failed: number; bouncedOrIssue: number; pendingOrUnknown: number };
};

export type AdminEmailDetail = AdminEmailListItem & {
  metadata: Record<string, unknown>;
  events: { id: string; source: string; eventType: string; status: string | null; occurredAt: string; createdAt: string; details: Record<string, unknown> }[];
  providerLastEvent: string | null;
  providerStatusError: string | null;
};

export type AdminMediaSource = "inspections" | "vehicles" | "vehicle-files";

export type AdminMediaItem = {
  id: string;
  source: AdminMediaSource;
  sourceLabel: string;
  title: string;
  fileName: string;
  previewUrl: string;
  vehicleId: string;
  vehiclePublicId: string;
  vehicleLabel: string;
  bookingId: string | null;
  bookingPublicId: string | null;
  category: string;
  categoryLabel: string;
  subtype: string;
  subtypeLabel: string;
  uploadedBy: string | null;
  createdAt: string;
  isPrimary: boolean;
  canRemoveAtSource: boolean;
};

export type AdminMediaPage = {
  source: AdminMediaSource;
  items: AdminMediaItem[];
  counts: Record<AdminMediaSource, number>;
  totalCount: number;
  page: number;
  totalPages: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
  options: { vehicles: { value: string; label: string }[]; categories: { value: string; label: string }[]; subtypes: { value: string; label: string }[] };
  warnings: string[];
};

type AdminSettingsErrorPayload = Partial<AdminSettingsPayload> & {
  error?: string;
  message?: string;
  fieldErrors?: AdminSettingsFieldErrors;
};

export class AdminSettingsError extends ApiError {
  constructor(message: string, status: number, readonly payload: AdminSettingsErrorPayload) {
    super(message, status);
    this.name = "AdminSettingsError";
  }
}

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

export async function fetchAdminVehicles(request: AdminRequest, includeDeleted = false) {
  const suffix = includeDeleted ? "?includeDeleted=1" : "";
  const data = await readAdminJson<{ vehicles: AdminVehicleListItem[] }>(request, `/api/admin/vehicles${suffix}`, { cache: "no-store" });
  if (!Array.isArray(data.vehicles)) throw new ApiError("The fleet service returned an invalid response.", 502);
  return data.vehicles;
}

export async function fetchAdminVehicle(request: AdminRequest, vehicleId: string) {
  const data = await readAdminJson<{ vehicle: AdminVehicleDetail }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}`, { cache: "no-store" });
  if (!isObject(data.vehicle) || typeof data.vehicle.id !== "string") throw new ApiError("The vehicle service returned an invalid response.", 502);
  return data.vehicle;
}

export async function fetchAdminVehicleProfile(request: AdminRequest, vehicleId: string) {
  const data = await readAdminJson<{ ok: true; profile: AdminVehicleProfile | null }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}/profile`, { cache: "no-store" });
  return data.profile;
}

export async function fetchAdminVehicleHistory(request: AdminRequest, vehicleId: string, view: "upcoming" | "history" = "upcoming", offset = 0) {
  const params = new URLSearchParams({ view, limit: "20", offset: String(offset) });
  const data = await readAdminJson<AdminVehicleHistory & { ok: true }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}/reservations?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.rows) || !isObject(data.summary) || !isObject(data.paging)) throw new ApiError("The fleet history service returned an invalid response.", 502);
  return data;
}

export async function fetchAdminVehicleNotes(request: AdminRequest, vehicleId: string) {
  const data = await readAdminJson<{ ok: true; items: AdminVehicleNote[] }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}/notes`, { cache: "no-store" });
  if (!Array.isArray(data.items)) throw new ApiError("The vehicle notes service returned an invalid response.", 502);
  return data.items;
}

export async function createAdminVehicle(request: AdminRequest, input: { make: string; model: string; year: number; seatCount: number | null; dailyRateJmd: number; depositJmd: number; status: string }) {
  const data = await readAdminJson<{ vehicle: AdminVehicleDetail }>(request, "/api/admin/vehicles", {
    method: "POST",
    body: JSON.stringify({ make: input.make, model: input.model, year: input.year, seat_count: input.seatCount, daily_rate_jmd: input.dailyRateJmd, deposit_jmd: input.depositJmd, status: input.status, public_visible: false, image_urls_json: [] }),
  });
  if (!isObject(data.vehicle) || typeof data.vehicle.id !== "string") throw new ApiError("The vehicle service returned an invalid response.", 502);
  return data.vehicle;
}

export async function updateAdminVehicle(request: AdminRequest, vehicleId: string, input: { make: string; model: string; year: number; seatCount: number | null; dailyRateJmd: number; depositJmd: number; status: string; profile?: Partial<AdminVehicleProfile> }) {
  const data = await readAdminJson<{ vehicle: AdminVehicleDetail }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ make: input.make, model: input.model, year: input.year, seat_count: input.seatCount, daily_rate: input.dailyRateJmd, deposit: input.depositJmd, status: input.status, profile: input.profile }),
  });
  return data.vehicle;
}

export async function updateAdminVehicleProfile(request: AdminRequest, vehicleId: string, input: Partial<AdminVehicleProfile>) {
  const data = await readAdminJson<{ ok: true; profile: AdminVehicleProfile }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}/profile`, { method: "PATCH", body: JSON.stringify(input) });
  return data.profile;
}

export async function createAdminVehicleNote(request: AdminRequest, vehicleId: string, noteText: string) {
  const data = await readAdminJson<{ ok: true; item: AdminVehicleNote }>(request, `/api/admin/vehicles/${encodeURIComponent(vehicleId)}/notes`, { method: "POST", body: JSON.stringify({ noteText }) });
  return data.item;
}

export async function fetchAdminMessages(request: AdminRequest, input: { q?: string; status?: string; source?: string; cursor?: string | null; limit?: number }) {
  const params = new URLSearchParams({ sortBy: "received", sortDir: "desc", limit: String(input.limit ?? 20) });
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.source && input.source !== "all") params.set("source", input.source);
  if (input.cursor) params.set("cursor", input.cursor);
  const data = await readAdminJson<AdminMessagesPage & { ok: true }>(request, `/api/admin/messages?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.items) || typeof data.totalCount !== "number") throw new ApiError("The messages service returned an invalid response.", 502);
  return data;
}

export async function fetchAdminMessage(request: AdminRequest, messageId: string, markRead = true) {
  const data = await readAdminJson<{ ok: true; item: AdminMessageDetail }>(request, `/api/admin/messages/${encodeURIComponent(messageId)}?markRead=${markRead ? "1" : "0"}`, { cache: "no-store" });
  if (!isObject(data.item) || typeof data.item.id !== "string") throw new ApiError("The message service returned an invalid response.", 502);
  return data.item;
}

export async function updateAdminMessage(request: AdminRequest, messageId: string, action: AdminMessageAction) {
  const data = await readAdminJson<{ ok: true; item: AdminMessageDetail; deleted?: boolean }>(request, `/api/admin/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: JSON.stringify({ action }) });
  return data;
}

export async function fetchAdminReports(request: AdminRequest, input: { rangeFrom: string; rangeTo: string; snapshotDate?: string; granularity?: "day" | "week" | "month" }) {
  const params = new URLSearchParams({ rangeFrom: input.rangeFrom, rangeTo: input.rangeTo, snapshotDate: input.snapshotDate ?? input.rangeTo, revenueGranularity: input.granularity ?? "day" });
  const data = await readAdminJson<{ ok: true; report: AdminReportsPayload }>(request, `/api/admin/reports?${params.toString()}`, { cache: "no-store" });
  if (!isObject(data.report) || !isObject(data.report.revenue) || !isObject(data.report.upcoming)) throw new ApiError("The reports service returned an invalid response.", 502);
  return data.report;
}

export async function fetchAdminUsers(request: AdminRequest, q = "") {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const data = await readAdminJson<{ users: AdminUserListItem[] }>(request, `/api/admin/users${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
  if (!Array.isArray(data.users)) throw new ApiError("The users service returned an invalid response.", 502);
  return data.users;
}

export async function createAdminUser(request: AdminRequest, input: { firstName: string; lastName: string; email: string; role: string }) {
  return readAdminJson<{ ok: true; userId: string; userPublicId: string | null; username: string; setupEmail: string; onboarding: { status: "setup_pending"; message: string; setupPath: string }; welcomeEmail: { warning?: string | null } | null }>(request, "/api/admin/users", { method: "POST", body: JSON.stringify(input) });
}

export async function updateAdminUser(request: AdminRequest, userId: string, action: AdminUserAction, payload: Record<string, unknown> = {}) {
  return readAdminJson<{ ok: true; message?: string; tempPassword?: string; tempPasswordExpiresAt?: string; setupEmail?: string; setupUrl?: string }>(request, `/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ action, ...payload }) });
}

function isAdminSettingsPayload(value: unknown): value is AdminSettingsPayload {
  return isObject(value)
    && isObject(value.settings)
    && isObject(value.ownership)
    && isObject(value.operationalRouting)
    && Array.isArray(value.operationalRouting.effectiveRecipients);
}

export async function fetchAdminSettings(request: AdminRequest) {
  const data = await readAdminJson<AdminSettingsPayload>(request, "/api/admin/settings", { cache: "no-store" });
  if (!isAdminSettingsPayload(data)) throw new ApiError("The settings service returned an invalid response.", 502);
  return data;
}

export async function saveAdminSettings(request: AdminRequest, settings: AdminSettings, baseUpdatedAt: string | null) {
  const response = await request("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings, baseUpdatedAt }),
  });
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const payload = isObject(data) ? data as AdminSettingsErrorPayload : {};
    throw new AdminSettingsError(
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : "The settings service could not save these changes.",
      response.status,
      payload,
    );
  }
  if (!isAdminSettingsPayload(data)) throw new ApiError("The settings service returned an invalid response.", 502);
  return data;
}

export async function fetchAdminCalendar(request: AdminRequest, input: { date: string; view: "week" | "month"; vehicleId?: string | null; status?: string }) {
  const params = new URLSearchParams({ date: input.date, view: input.view });
  if (input.vehicleId) params.set("vehicleId", input.vehicleId);
  if (input.status && input.status !== "all") params.set("status", input.status);
  const data = await readAdminJson<AdminCalendarPayload>(request, `/api/admin/calendar?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.days) || !Array.isArray(data.bookings) || !Array.isArray(data.blockouts) || !Array.isArray(data.vehicles)) {
    throw new ApiError("The calendar service returned an invalid response.", 502);
  }
  return data;
}

export async function fetchAdminPayments(request: AdminRequest, input: { q?: string; type?: string; state?: string; provider?: string; cursor?: string | null; limit?: number }) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.type && input.type !== "all") params.set("type", input.type);
  if (input.state && input.state !== "all") params.set("state", input.state);
  if (input.provider && input.provider !== "all") params.set("provider", input.provider);
  if (input.cursor) params.set("cursor", input.cursor);
  params.set("limit", String(input.limit ?? 20));
  const data = await readAdminJson<AdminPaymentsPage>(request, `/api/admin/payments?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.items) || !isObject(data.summary) || typeof data.totalCount !== "number") {
    throw new ApiError("The payments service returned an invalid response.", 502);
  }
  return data;
}

export async function updateAdminPayment(request: AdminRequest, paymentId: string, action: "delete" | "restore", reason: string) {
  return readAdminJson<{ ok: true; summary?: unknown }>(request, `/api/admin/payments/${encodeURIComponent(paymentId)}`, {
    method: "PATCH",
    body: JSON.stringify(action === "delete" ? { action, reason } : { action, note: reason }),
  });
}

export async function recordAdminRefundAdjustment(request: AdminRequest, paymentId: string, reason: string) {
  return readAdminJson<{ ok: true; message?: string; summary?: unknown }>(request, `/api/admin/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function fetchAdminMaintenance(request: AdminRequest, input: { q?: string; dueState?: string; status?: string; category?: string; onlyActive?: boolean }) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.dueState && input.dueState !== "all") params.set("dueState", input.dueState);
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.category && input.category !== "all") params.set("category", input.category);
  if (input.onlyActive === false) params.set("onlyActive", "0");
  const data = await readAdminJson<{ ok: true; items: AdminMaintenanceItem[] }>(request, `/api/admin/maintenance${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
  if (!Array.isArray(data.items)) throw new ApiError("The maintenance service returned an invalid response.", 502);
  return data.items;
}

export async function fetchAdminPromos(request: AdminRequest, input: { q?: string; page?: number; rows?: number }) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  params.set("page", String(input.page ?? 1));
  params.set("rows", String(input.rows ?? 20));
  const data = await readAdminJson<AdminPromosPage>(request, `/api/admin/promo-codes?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.promos) || typeof data.totalCount !== "number" || typeof data.page !== "number") {
    throw new ApiError("The promotions service returned an invalid response.", 502);
  }
  return data;
}

export async function fetchAdminPromo(request: AdminRequest, promoId: string, activityPage = 1) {
  const data = await readAdminJson<AdminPromoDetail>(request, `/api/admin/promo-codes/${encodeURIComponent(promoId)}?activityPage=${activityPage}`, { cache: "no-store" });
  if (!isObject(data.promo) || !isObject(data.summary) || !isObject(data.activity) || !Array.isArray(data.activity.rows)) {
    throw new ApiError("The promotion service returned an invalid response.", 502);
  }
  return data;
}

export async function setAdminPromoActive(request: AdminRequest, promoId: string, isActive: boolean) {
  return readAdminJson<{ ok: true }>(request, `/api/admin/promo-codes/${encodeURIComponent(promoId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "set_active", isActive }),
  });
}

export async function createAdminPromo(request: AdminRequest, input: AdminPromoInput) {
  return readAdminJson<{ ok: true; promoId: string; promoPublicId: string }>(request, "/api/admin/promo-codes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAdminPromo(request: AdminRequest, promoId: string, input: AdminPromoInput) {
  return readAdminJson<{ ok: true }>(request, `/api/admin/promo-codes/${encodeURIComponent(promoId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function fetchAdminEmails(request: AdminRequest, input: { q?: string; status?: string; emailType?: string; entityType?: string; triggerSource?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams({ page: String(input.page ?? 1), limit: String(input.limit ?? 20), sortBy: "lastEvent", sortDir: "desc" });
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.emailType?.trim()) params.set("emailType", input.emailType.trim());
  if (input.entityType?.trim()) params.set("entityType", input.entityType.trim());
  if (input.triggerSource?.trim()) params.set("triggerSource", input.triggerSource.trim());
  if (input.dateFrom?.trim()) params.set("dateFrom", input.dateFrom.trim());
  if (input.dateTo?.trim()) params.set("dateTo", input.dateTo.trim());
  const data = await readAdminJson<AdminEmailsPage & { ok: true }>(request, `/api/admin/emails?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.items) || typeof data.totalCount !== "number" || !isObject(data.summary)) throw new ApiError("The email activity service returned an invalid response.", 502);
  return data;
}

export async function fetchAdminEmail(request: AdminRequest, emailId: string) {
  const data = await readAdminJson<{ ok: true; item: AdminEmailDetail }>(request, `/api/admin/emails/${encodeURIComponent(emailId)}`, { cache: "no-store" });
  if (!isObject(data.item) || !Array.isArray(data.item.events)) throw new ApiError("The email detail service returned an invalid response.", 502);
  return data.item;
}

export async function resendAdminEmail(request: AdminRequest, emailId: string) {
  return readAdminJson<{ ok: true }>(request, `/api/admin/emails/${encodeURIComponent(emailId)}/resend`, { method: "POST", body: "{}" });
}

export async function fetchAdminMedia(request: AdminRequest, input: { source: AdminMediaSource; q?: string; vehicleId?: string; category?: string; subtype?: string; dateFrom?: string; dateTo?: string; sort?: "newest" | "oldest"; page?: number }) {
  const params = new URLSearchParams({ source: input.source, page: String(input.page ?? 1), sort: input.sort ?? "newest" });
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.vehicleId) params.set("vehicleId", input.vehicleId);
  if (input.category) params.set("category", input.category);
  if (input.subtype) params.set("subtype", input.subtype);
  if (input.dateFrom?.trim()) params.set("dateFrom", input.dateFrom.trim());
  if (input.dateTo?.trim()) params.set("dateTo", input.dateTo.trim());
  const data = await readAdminJson<AdminMediaPage & { ok: true }>(request, `/api/admin/media?${params.toString()}`, { cache: "no-store" });
  if (!Array.isArray(data.items) || !isObject(data.counts) || !isObject(data.options) || typeof data.totalCount !== "number") throw new ApiError("The media service returned an invalid response.", 502);
  return data;
}
