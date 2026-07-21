import type { AdminSettings, AdminSettingsFieldErrors } from "./api";

export type SettingsForm = {
  minimumRentalDays: string;
  contactCooldown: string;
  contactEmails: string;
  defaultOperationalEmail: string;
  additionalOperationalEmails: string;
  maintenanceLeadDays: string;
  maintenanceDueSoonDays: string;
  maintenanceDueSoonKm: string;
  maintenanceCategories: string;
  maintenancePriorities: string;
  documentFolders: string;
  documentTypes: string;
  depreciationUsefulLife: string;
  depreciationResidual: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function formFromSettings(settings: AdminSettings): SettingsForm {
  return {
    minimumRentalDays: String(settings.bookingMinimumRentalDays.globalDefaultDays),
    contactCooldown: String(settings.contactNotifyCooldownMinutes),
    contactEmails: settings.contactNotificationEmails,
    defaultOperationalEmail: settings.defaultOperationalNotificationEmail,
    additionalOperationalEmails: settings.additionalOperationalNotificationEmails.join("\n"),
    maintenanceLeadDays: String(settings.maintenanceReminderLeadDays),
    maintenanceDueSoonDays: String(settings.maintenanceDueSoonDays),
    maintenanceDueSoonKm: String(settings.maintenanceDueSoonKm),
    maintenanceCategories: settings.maintenanceCategories.join("\n"),
    maintenancePriorities: settings.maintenancePriorities.join("\n"),
    documentFolders: settings.vehicleDocumentFolders.join("\n"),
    documentTypes: settings.vehicleDocumentTypeOptions.join("\n"),
    depreciationUsefulLife: String(settings.depreciationDefaultUsefulLifeMonths),
    depreciationResidual: String(settings.depreciationDefaultResidualPercent),
  };
}

export function settingsSnapshot(settings: AdminSettings, form: SettingsForm) {
  return JSON.stringify({ settings, form });
}

function splitList(value: string) {
  return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
}

function validInteger(value: string, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function invalidEmails(value: string) {
  return splitList(value).filter((email) => !EMAIL_PATTERN.test(email.toLowerCase()));
}

export function prepareAdminSettings(
  settings: AdminSettings,
  form: SettingsForm,
): { ok: true; settings: AdminSettings } | { ok: false; errors: AdminSettingsFieldErrors } {
  const errors: AdminSettingsFieldErrors = {};
  const minimumDays = validInteger(form.minimumRentalDays, 1, 30);
  const cooldown = validInteger(form.contactCooldown, 1, 120);
  const leadDays = validInteger(form.maintenanceLeadDays, 1, 90);
  const dueDays = validInteger(form.maintenanceDueSoonDays, 1, 180);
  const dueKm = validInteger(form.maintenanceDueSoonKm, 0, 25000);
  const usefulLife = validInteger(form.depreciationUsefulLife, 1, 240);
  const residual = validInteger(form.depreciationResidual, 0, 95);
  const contactEmails = splitList(form.contactEmails).map((value) => value.toLowerCase());
  const additionalEmails = splitList(form.additionalOperationalEmails).map((value) => value.toLowerCase());
  const defaultEmail = form.defaultOperationalEmail.trim().toLowerCase();
  const folders = splitList(form.documentFolders);
  const documentTypes = splitList(form.documentTypes);
  const categories = splitList(form.maintenanceCategories).map((value) => value.toUpperCase());
  const priorities = splitList(form.maintenancePriorities).map((value) => value.toUpperCase());

  if (minimumDays === null) errors.bookingMinimumRentalDays = "Minimum rental days must be a whole number from 1 to 30.";
  if (cooldown === null) errors.contactNotifyCooldownMinutes = "Cooldown must be a whole number from 1 to 120.";
  if (leadDays === null) errors.maintenanceReminderLeadDays = "Lead days must be a whole number from 1 to 90.";
  if (dueDays === null) errors.maintenanceDueSoonDays = "Due-soon days must be a whole number from 1 to 180.";
  if (dueKm === null) errors.maintenanceDueSoonKm = "Due-soon distance must be a whole number from 0 to 25,000.";
  if (usefulLife === null) errors.depreciationDefaultUsefulLifeMonths = "Useful life must be a whole number from 1 to 240.";
  if (residual === null) errors.depreciationDefaultResidualPercent = "Residual value must be a whole number from 0 to 95.";
  const badContactEmails = contactEmails.filter((email) => !EMAIL_PATTERN.test(email));
  if (badContactEmails.length) errors.contactNotificationEmails = `Invalid email: ${badContactEmails.join(", ")}`;
  if (defaultEmail && !EMAIL_PATTERN.test(defaultEmail)) errors.defaultOperationalNotificationEmail = "Enter a valid operational email address.";
  const badAdditionalEmails = invalidEmails(form.additionalOperationalEmails);
  if (badAdditionalEmails.length) errors.additionalOperationalNotificationEmails = `Invalid email: ${badAdditionalEmails.join(", ")}`;
  if (!folders.length) errors.vehicleDocumentFolders = "Add at least one vehicle document folder.";
  if (!documentTypes.length) errors.vehicleDocumentTypeOptions = "Add at least one vehicle document type.";
  if (!categories.length) errors.maintenanceCategories = "Add at least one maintenance category.";
  if (!priorities.length) errors.maintenancePriorities = "Add at least one maintenance priority.";
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      ...settings,
      contactNotificationEmails: contactEmails.join(", "),
      contactNotifyCooldownMinutes: cooldown!,
      defaultOperationalNotificationEmail: defaultEmail,
      additionalOperationalNotificationEmails: additionalEmails,
      vehicleDocumentFolders: folders,
      vehicleDocumentTypeOptions: documentTypes,
      maintenanceReminderLeadDays: leadDays!,
      maintenanceDueSoonDays: dueDays!,
      maintenanceDueSoonKm: dueKm!,
      maintenanceCategories: categories,
      maintenancePriorities: priorities,
      depreciationDefaultUsefulLifeMonths: usefulLife!,
      depreciationDefaultResidualPercent: residual!,
      bookingMinimumRentalDays: { ...settings.bookingMinimumRentalDays, globalDefaultDays: minimumDays! },
    },
  };
}
