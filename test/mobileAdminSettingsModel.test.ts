import assert from "node:assert/strict";
import test from "node:test";

import type { AdminSettings } from "../mobile/src/admin/api";
import { formFromSettings, prepareAdminSettings } from "../mobile/src/admin/settingsModel";

const settings: AdminSettings = {
  authLoginMethod: "clerk",
  blockoutSupersedesBookings: false,
  requireRestoreReason: true,
  sendPickupReminder: true,
  sendDropoffReminder: false,
  sendLateDropoffAlert: false,
  dayViewBookingLimit: 5,
  contactNotificationEmails: "admin@example.com",
  contactNotifyCooldownMinutes: 10,
  primaryAdminUserId: "admin-1",
  primaryDeveloperUserId: "developer-1",
  defaultOperationalNotificationEmail: "ops@example.com",
  additionalOperationalNotificationEmails: ["fleet@example.com"],
  sendVehicleInspectionWarningEmails: true,
  vehicleDocumentFolders: ["Insurance", "Registration"],
  vehicleDocumentTypeOptions: ["Certificate", "Receipt"],
  vehicleChecklistTemplates: [{ key: "insurance", label: "Insurance", folder: "Insurance", required: true, allowNotRequired: true, expiryRequired: true, expiryWarningDays: 30, isActive: true }],
  vehicleChecklistTemplateItems: ["Insurance"],
  maintenanceRemindersEnabled: true,
  maintenanceReminderLeadDays: 7,
  maintenanceDueSoonDays: 14,
  maintenanceDueSoonKm: 500,
  maintenanceCategories: ["SERVICE", "REPAIR"],
  maintenancePriorities: ["NORMAL", "URGENT"],
  depreciationDefaultMethod: "STRAIGHT_LINE",
  depreciationDefaultUsefulLifeMonths: 60,
  depreciationDefaultResidualPercent: 20,
  bookingMinimumRentalDays: { globalDefaultDays: 2 },
  bookingVehicleSecurityDeposits: { vehicleDepositsJmd: { "vehicle-1": 50000 } },
};

test("mobile settings preparation preserves hidden and per-vehicle settings", () => {
  const form = formFromSettings(settings);
  form.minimumRentalDays = "4";
  form.contactEmails = "ADMIN@example.com; reservations@example.com";
  const result = prepareAdminSettings(settings, form);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.settings.bookingMinimumRentalDays.globalDefaultDays, 4);
  assert.equal(result.settings.contactNotificationEmails, "admin@example.com, reservations@example.com");
  assert.deepEqual(result.settings.vehicleChecklistTemplates, settings.vehicleChecklistTemplates);
  assert.deepEqual(result.settings.bookingVehicleSecurityDeposits, settings.bookingVehicleSecurityDeposits);
  assert.equal(result.settings.authLoginMethod, "clerk");
  assert.equal(result.settings.primaryDeveloperUserId, "developer-1");
});

test("mobile settings preparation blocks invalid ranges, email addresses, and empty operational lists", () => {
  const form = formFromSettings(settings);
  form.minimumRentalDays = "0";
  form.contactCooldown = "121";
  form.defaultOperationalEmail = "not-an-email";
  form.maintenanceCategories = "";
  form.documentFolders = "";
  const result = prepareAdminSettings(settings, form);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.bookingMinimumRentalDays);
  assert.ok(result.errors.contactNotifyCooldownMinutes);
  assert.ok(result.errors.defaultOperationalNotificationEmail);
  assert.ok(result.errors.maintenanceCategories);
  assert.ok(result.errors.vehicleDocumentFolders);
});
