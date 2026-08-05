export const ADMIN_ROLES = ["OPERATIONS", "ADMIN", "DEVELOPER"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminCapability =
  | "dashboard.read"
  | "bookings.read"
  | "bookings.write"
  | "quotes.read"
  | "quotes.write"
  | "customers.read"
  | "customers.write"
  | "calendar.read"
  | "vehicles.read"
  | "vehicles.write"
  | "messages.read"
  | "messages.write"
  | "reports.read"
  | "payments.read"
  | "payments.write"
  | "maintenance.read"
  | "maintenance.write"
  | "promotions.read"
  | "promotions.write"
  | "emails.read"
  | "media.read"
  | "settings.read"
  | "settings.write"
  | "users.read"
  | "users.write";

const OPERATIONS_CAPABILITIES: readonly AdminCapability[] = [
  "dashboard.read",
  "bookings.read",
  "bookings.write",
  "quotes.read",
  "quotes.write",
  "customers.read",
  "customers.write",
  "calendar.read",
];

const ADMIN_CAPABILITIES: readonly AdminCapability[] = [
  ...OPERATIONS_CAPABILITIES,
  "vehicles.read",
  "vehicles.write",
  "messages.read",
  "messages.write",
  "reports.read",
  "payments.read",
  "payments.write",
  "maintenance.read",
  "maintenance.write",
  "promotions.read",
  "promotions.write",
  "emails.read",
  "media.read",
  "settings.read",
  "settings.write",
  "users.read",
  "users.write",
];

export const ROLE_CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
  OPERATIONS: OPERATIONS_CAPABILITIES,
  ADMIN: ADMIN_CAPABILITIES,
  DEVELOPER: ADMIN_CAPABILITIES,
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && ADMIN_ROLES.includes(value as AdminRole);
}

export function hasCapability(role: AdminRole, capability: AdminCapability) {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export type AdminModule = {
  key: string;
  title: string;
  description: string;
  icon: string;
  href: string;
  capability: AdminCapability;
  group: "work" | "business" | "system";
};

export const ADMIN_MODULES: readonly AdminModule[] = [
  { key: "bookings", title: "Bookings", description: "Manage reservations, payments, documents, and trip status.", icon: "calendar", href: "/admin/bookings", capability: "bookings.read", group: "work" },
  { key: "quotes", title: "Quotes", description: "Prepare, send, revise, and convert customer quotes.", icon: "description", href: "/admin/quotes", capability: "quotes.read", group: "work" },
  { key: "customers", title: "Customers", description: "Customer profiles, booking history, account state, and contact details.", icon: "groups", href: "/admin/customers", capability: "customers.read", group: "work" },
  { key: "calendar", title: "Calendar", description: "See pickups, returns, availability, and operational conflicts.", icon: "date-range", href: "/admin/calendar", capability: "calendar.read", group: "work" },
  { key: "vehicles", title: "Vehicles", description: "Fleet status, rates, reservations, notes, and readiness.", icon: "directions-car", href: "/admin/vehicles", capability: "vehicles.read", group: "business" },
  { key: "messages", title: "Messages", description: "Triage customer enquiries and service alerts.", icon: "forum", href: "/admin/messages", capability: "messages.read", group: "work" },
  { key: "reports", title: "Reports", description: "Revenue, utilization, balances, and business performance.", icon: "monitoring", href: "/admin/reports", capability: "reports.read", group: "business" },
  { key: "payments", title: "Payments", description: "Review transactions, exceptions, and refunds.", icon: "payments", href: "/admin/payments", capability: "payments.read", group: "business" },
  { key: "maintenance", title: "Maintenance", description: "Service schedules, overdue work, and vehicle readiness.", icon: "build", href: "/admin/maintenance", capability: "maintenance.read", group: "business" },
  { key: "promotions", title: "Promotions", description: "Promo codes, eligibility, usage, and discount controls.", icon: "sell", href: "/admin/promotions", capability: "promotions.read", group: "business" },
  { key: "emails", title: "Email activity", description: "Delivery history, failures, and resend operations.", icon: "mail", href: "/admin/emails", capability: "emails.read", group: "system" },
  { key: "media", title: "Media", description: "Vehicle, inspection, and document media library.", icon: "photo-library", href: "/admin/media", capability: "media.read", group: "system" },
  { key: "settings", title: "Settings", description: "Rental rules, locations, protection, and app preferences.", icon: "settings", href: "/admin/settings", capability: "settings.read", group: "system" },
  { key: "users", title: "Users", description: "Staff access, roles, account state, and onboarding.", icon: "admin-panel-settings", href: "/admin/users", capability: "users.read", group: "system" },
] as const;

export function modulesForRole(role: AdminRole) {
  return ADMIN_MODULES.filter((module) => hasCapability(role, module.capability));
}
