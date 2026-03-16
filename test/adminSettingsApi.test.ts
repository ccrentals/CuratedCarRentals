import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import {
  handleAdminSettingsGet,
  handleAdminSettingsPatch,
} from "@/app/api/admin/settings/route";
import type { NotificationOwnershipDirectory } from "@/lib/notifications/operationalRouting";

type StoredRow = {
  content: string | null;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_email: string | null;
};

function adminAuth() {
  return {
    ok: true as const,
    actor: {
      userId: "admin-user-id",
      role: "ADMIN",
      appRole: "ADMIN",
    },
  };
}

function developerAuth() {
  return {
    ok: true as const,
    actor: {
      userId: "developer-user-id",
      role: "DEVELOPER",
      appRole: "DEVELOPER",
    },
  };
}

function unauthorizedAuth() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}

function createSettingsQueryHarness(initialRow: StoredRow | null) {
  let row = initialRow ? { ...initialRow } : null;

  return {
    query: async <T>(sql: string, params: unknown[] = []) => {
      if (sql.includes("select d.content, d.updated_at, d.updated_by")) {
        return { rows: row ? [row as T] : [] };
      }

      if (sql.includes("update admin_documents")) {
        if (!row) return { rows: [] as T[] };
        const expectedUpdatedAt = typeof params[3] === "string" ? params[3] : null;
        if (!expectedUpdatedAt || expectedUpdatedAt !== row.updated_at) {
          return { rows: [] as T[] };
        }
        row = {
          content: String(params[1] ?? ""),
          updated_at: "2026-03-14T15:30:00.000Z",
          updated_by: String(params[2] ?? ""),
          updated_by_email: "admin@example.com",
        };
        return { rows: [row as T] };
      }

      if (sql.includes("insert into admin_documents")) {
        if (row) {
          return { rows: [] as T[] };
        }
        row = {
          content: String(params[1] ?? ""),
          updated_at: "2026-03-14T15:30:00.000Z",
          updated_by: String(params[2] ?? ""),
          updated_by_email: "admin@example.com",
        };
        return { rows: [row as T] };
      }

      throw new Error(`Unexpected SQL in test harness: ${sql}`);
    },
    getRow() {
      return row;
    },
  };
}

function makeOwnershipDirectory(
  overrides: Partial<NotificationOwnershipDirectory> = {},
): NotificationOwnershipDirectory {
  return {
    primaryAdmin: {
      kind: "primaryAdmin",
      userId: null,
      status: "missing",
      email: null,
      fullName: null,
      username: null,
      role: null,
      roleLabel: "Not set",
      label: "Not selected",
      isLocked: false,
      message: "No primary admin account selected.",
    },
    primaryDeveloper: {
      kind: "primaryDeveloper",
      userId: null,
      status: "missing",
      email: null,
      fullName: null,
      username: null,
      role: null,
      roleLabel: "Not set",
      label: "Not selected",
      isLocked: false,
      message: "No primary developer account selected.",
    },
    primaryAdminOptions: [],
    primaryDeveloperOptions: [],
    ...overrides,
  };
}

test("admin settings API: GET requires admin auth", async () => {
  const response = await handleAdminSettingsGet(
    new Request("http://localhost/api/admin/settings"),
    {
      requireAdmin: async () => unauthorizedAuth(),
      query: async () => ({ rows: [] }),
      resolveNotificationOwnership: async () => makeOwnershipDirectory(),
    },
  );

  assert.equal(response.status, 401);
});

test("admin settings API: PATCH enforces CSRF", async () => {
  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          contactNotificationEmails: "ops@example.com",
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "bad-token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => false,
      query: async () => ({ rows: [] }),
      resolveNotificationOwnership: async () => makeOwnershipDirectory(),
    },
  );

  assert.equal(response.status, 403);
});

test("admin settings API: PATCH returns validation errors for malformed input", async () => {
  const oversizedRecipientList = Array.from({ length: 26 }, (_, index) => `ops${index}@example.com`).join(", ");
  const oversizedOperationalRecipientList = Array.from({ length: 26 }, (_, index) => `routing${index}@example.com`).join(", ");
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      contactNotificationEmails: "",
      defaultOperationalNotificationEmail: "",
      additionalOperationalNotificationEmails: [],
      vehicleDocumentFolders: ["Paperwork"],
      vehicleDocumentTypeOptions: ["Registration"],
      maintenanceCategories: ["SERVICE"],
      maintenancePriorities: ["NORMAL"],
    }),
    updated_at: "2026-03-14T12:00:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          contactNotificationEmails: `${oversizedRecipientList}, invalid-email`,
          defaultOperationalNotificationEmail: "bad-email",
          additionalOperationalNotificationEmails: `${oversizedOperationalRecipientList}, invalid-email`,
          contactNotifyCooldownMinutes: 999,
          vehicleDocumentFolders: [],
          vehicleDocumentTypeOptions: [],
          maintenanceCategories: [],
          maintenancePriorities: [],
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () => makeOwnershipDirectory(),
    },
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as {
    error?: string;
    fieldErrors?: Record<string, string>;
  };
  assert.equal(payload.error, "SETTINGS_VALIDATION_FAILED");
  assert.match(payload.fieldErrors?.contactNotificationEmails ?? "", /valid email/i);
  assert.match(payload.fieldErrors?.contactNotificationEmails ?? "", /25 email addresses or fewer/i);
  assert.match(payload.fieldErrors?.defaultOperationalNotificationEmail ?? "", /valid default operational/i);
  assert.match(payload.fieldErrors?.additionalOperationalNotificationEmails ?? "", /valid email/i);
  assert.match(payload.fieldErrors?.additionalOperationalNotificationEmails ?? "", /25 email addresses or fewer/i);
  assert.match(payload.fieldErrors?.contactNotifyCooldownMinutes ?? "", /between 1 and 120/i);
  assert.match(payload.fieldErrors?.vehicleDocumentFolders ?? "", /at least one/i);
  assert.equal(harness.getRow()?.updated_at, "2026-03-14T12:00:00.000Z");
});

test("admin settings API: PATCH returns normalized persisted settings and metadata", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      contactNotificationEmails: "",
      defaultOperationalNotificationEmail: "",
      additionalOperationalNotificationEmails: [],
      vehicleDocumentFolders: ["Paperwork"],
      vehicleDocumentTypeOptions: ["Registration"],
      maintenanceCategories: ["SERVICE"],
      maintenancePriorities: ["NORMAL"],
      dayViewBookingLimit: 5,
      contactNotifyCooldownMinutes: 10,
      maintenanceReminderLeadDays: 7,
      maintenanceDueSoonDays: 14,
      maintenanceDueSoonKm: 500,
      depreciationDefaultUsefulLifeMonths: 60,
      depreciationDefaultResidualPercent: 20,
    }),
    updated_at: "2026-03-14T12:00:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          contactNotificationEmails: "ops@example.com; sales@example.com",
          defaultOperationalNotificationEmail: "OPS@example.com",
          additionalOperationalNotificationEmails: [
            "fleet@example.com",
            "ops@example.com",
            "dispatch@example.com",
          ],
          sendVehicleInspectionWarningEmails: true,
          vehicleDocumentFolders: ["Paperwork", "Registration"],
          vehicleDocumentTypeOptions: ["Registration", "Insurance Certificate"],
          maintenanceCategories: ["SERVICE", "INSPECTION"],
          maintenancePriorities: ["LOW", "NORMAL"],
          dayViewBookingLimit: "10",
          contactNotifyCooldownMinutes: "30",
          maintenanceReminderLeadDays: "14",
          maintenanceDueSoonDays: "21",
          maintenanceDueSoonKm: "750",
          depreciationDefaultUsefulLifeMonths: "72",
          depreciationDefaultResidualPercent: "25",
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () =>
        makeOwnershipDirectory({
          primaryAdmin: {
            kind: "primaryAdmin",
            userId: "admin-user-id",
            status: "valid",
            email: "admin@example.com",
            fullName: "Admin User",
            username: null,
            role: "ADMIN",
            roleLabel: "Admin",
            label: "Admin User (admin@example.com) — Admin",
            isLocked: false,
            message: "Primary admin account is valid.",
          },
          primaryDeveloper: {
            kind: "primaryDeveloper",
            userId: "developer-user-id",
            status: "valid",
            email: "developer@example.com",
            fullName: "Developer User",
            username: null,
            role: "DEVELOPER",
            roleLabel: "Developer",
            label: "Developer User (developer@example.com) — Developer",
            isLocked: false,
            message: "Primary developer account is valid.",
          },
        }),
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    settings?: {
      contactNotificationEmails?: string;
      defaultOperationalNotificationEmail?: string;
      additionalOperationalNotificationEmails?: string[];
      sendVehicleInspectionWarningEmails?: boolean;
      dayViewBookingLimit?: number | string;
      maintenanceDueSoonKm?: number;
    };
    operationalRouting?: {
      effectiveRecipients?: string[];
      hasConfiguredRecipients?: boolean;
      usesFallback?: boolean;
    };
    updatedAt?: string | null;
    updatedByEmail?: string | null;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.settings?.contactNotificationEmails, "ops@example.com, sales@example.com");
  assert.equal(payload.settings?.defaultOperationalNotificationEmail, "ops@example.com");
  assert.deepEqual(payload.settings?.additionalOperationalNotificationEmails, [
    "fleet@example.com",
    "ops@example.com",
    "dispatch@example.com",
  ]);
  assert.equal(payload.settings?.sendVehicleInspectionWarningEmails, true);
  assert.equal(payload.settings?.dayViewBookingLimit, 10);
  assert.equal(payload.settings?.maintenanceDueSoonKm, 750);
  assert.deepEqual(payload.operationalRouting?.effectiveRecipients, [
    "ops@example.com",
    "fleet@example.com",
    "dispatch@example.com",
  ]);
  assert.equal(payload.operationalRouting?.hasConfiguredRecipients, true);
  assert.equal(payload.operationalRouting?.usesFallback, false);
  assert.equal(payload.updatedAt, "2026-03-14T15:30:00.000Z");
  assert.equal(payload.updatedByEmail, "admin@example.com");
  assert.equal(harness.getRow()?.updated_by_email, "admin@example.com");
});

test("admin settings API: PATCH rejects stale baseUpdatedAt and returns latest settings", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      contactNotificationEmails: "latest@example.com",
      vehicleDocumentFolders: ["Paperwork"],
      vehicleDocumentTypeOptions: ["Registration"],
      maintenanceCategories: ["SERVICE"],
      maintenancePriorities: ["NORMAL"],
    }),
    updated_at: "2026-03-14T12:30:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          contactNotificationEmails: "ops@example.com",
          vehicleDocumentFolders: ["Paperwork"],
          vehicleDocumentTypeOptions: ["Registration"],
          maintenanceCategories: ["SERVICE"],
          maintenancePriorities: ["NORMAL"],
        },
        baseUpdatedAt: "2026-03-14T11:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () => makeOwnershipDirectory(),
    },
  );

  assert.equal(response.status, 409);
  const payload = (await response.json()) as {
    error?: string;
    settings?: { contactNotificationEmails?: string };
    updatedAt?: string | null;
    updatedByEmail?: string | null;
  };
  assert.equal(payload.error, "SETTINGS_CONFLICT");
  assert.equal(payload.settings?.contactNotificationEmails, "latest@example.com");
  assert.equal(payload.updatedAt, "2026-03-14T12:30:00.000Z");
  assert.equal(payload.updatedByEmail, "seed@example.com");
});

test("admin settings API: PATCH rejects invalid ownership selections", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      primaryAdminUserId: null,
      primaryDeveloperUserId: null,
    }),
    updated_at: "2026-03-14T12:00:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          primaryAdminUserId: "missing-admin",
          primaryDeveloperUserId: "inactive-dev",
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () =>
        makeOwnershipDirectory({
          primaryAdmin: {
            kind: "primaryAdmin",
            userId: "missing-admin",
            status: "not_found",
            email: null,
            fullName: null,
            username: null,
            role: null,
            roleLabel: "Unavailable",
            label: "Missing user",
            isLocked: false,
            message: "The selected primary admin account no longer exists.",
          },
          primaryDeveloper: {
            kind: "primaryDeveloper",
            userId: "inactive-dev",
            status: "inactive",
            email: "dev@example.com",
            fullName: "Dev User",
            username: null,
            role: "DEVELOPER",
            roleLabel: "Developer",
            label: "Dev User (dev@example.com) — Developer",
            isLocked: false,
            message: "The selected primary developer account is inactive.",
          },
        }),
    },
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as {
    fieldErrors?: Record<string, string>;
  };
  assert.match(payload.fieldErrors?.primaryAdminUserId ?? "", /no longer exists/i);
  assert.match(payload.fieldErrors?.primaryDeveloperUserId ?? "", /inactive/i);
});

test("admin settings API: PATCH restricts primary developer changes to DEVELOPER users", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      primaryDeveloperUserId: "developer-a",
    }),
    updated_at: "2026-03-14T12:00:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          primaryDeveloperUserId: "developer-b",
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () =>
        makeOwnershipDirectory({
          primaryDeveloper: {
            kind: "primaryDeveloper",
            userId: "developer-b",
            status: "valid",
            email: "developer@example.com",
            fullName: "Developer User",
            username: null,
            role: "DEVELOPER",
            roleLabel: "Developer",
            label: "Developer User (developer@example.com) — Developer",
            isLocked: false,
            message: "Primary developer account is valid.",
          },
        }),
    },
  );

  assert.equal(response.status, 403);
  const payload = (await response.json()) as { message?: string };
  assert.match(payload.message ?? "", /Only DEVELOPER users can change the primary developer account/i);
});

test("admin settings API: PATCH allows DEVELOPER users to change primary developer account", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      primaryDeveloperUserId: "developer-a",
    }),
    updated_at: "2026-03-14T12:00:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          primaryDeveloperUserId: "developer-b",
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => developerAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () =>
        makeOwnershipDirectory({
          primaryDeveloper: {
            kind: "primaryDeveloper",
            userId: "developer-b",
            status: "valid",
            email: "developer@example.com",
            fullName: "Developer User",
            username: null,
            role: "DEVELOPER",
            roleLabel: "Developer",
            label: "Developer User (developer@example.com) — Developer",
            isLocked: false,
            message: "Primary developer account is valid.",
          },
        }),
    },
  );

  assert.equal(response.status, 200);
});

test("admin settings API: PATCH blocks enabling warning emails when no recipients resolve", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      sendVehicleInspectionWarningEmails: false,
      defaultOperationalNotificationEmail: "",
      additionalOperationalNotificationEmails: [],
    }),
    updated_at: "2026-03-14T12:00:00.000Z",
    updated_by: "seed-user-id",
    updated_by_email: "seed@example.com",
  });

  const response = await handleAdminSettingsPatch(
    new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        settings: {
          sendVehicleInspectionWarningEmails: true,
          defaultOperationalNotificationEmail: "",
          additionalOperationalNotificationEmails: [],
        },
        baseUpdatedAt: "2026-03-14T12:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    {
      requireAdmin: async () => adminAuth(),
      requireCsrfCheck: async () => true,
      query: harness.query,
      resolveNotificationOwnership: async () => makeOwnershipDirectory(),
      resolveOperationalRouting: async () => ({
        configuredRecipients: [],
        effectiveRecipients: [],
        recipients: [],
        hasConfiguredRecipients: false,
        usesFallback: false,
        warnings: ["No valid operational notification recipients are configured."],
      }),
    },
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as {
    fieldErrors?: Record<string, string>;
  };
  assert.match(
    payload.fieldErrors?.sendVehicleInspectionWarningEmails ?? "",
    /at least one valid operational recipient resolves/i,
  );
  assert.equal(harness.getRow()?.updated_at, "2026-03-14T12:00:00.000Z");
});
