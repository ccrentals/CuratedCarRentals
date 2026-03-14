import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import {
  handleAdminSettingsGet,
  handleAdminSettingsPatch,
} from "@/app/api/admin/settings/route";

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

test("admin settings API: GET requires admin auth", async () => {
  const response = await handleAdminSettingsGet(
    new Request("http://localhost/api/admin/settings"),
    {
      requireAdmin: async () => unauthorizedAuth(),
      query: async () => ({ rows: [] }),
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
    },
  );

  assert.equal(response.status, 403);
});

test("admin settings API: PATCH returns validation errors for malformed input", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      contactNotificationEmails: "",
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
          contactNotificationEmails: "invalid-email",
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
    },
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as {
    error?: string;
    fieldErrors?: Record<string, string>;
  };
  assert.equal(payload.error, "SETTINGS_VALIDATION_FAILED");
  assert.match(payload.fieldErrors?.contactNotificationEmails ?? "", /valid email/i);
  assert.match(payload.fieldErrors?.vehicleDocumentFolders ?? "", /at least one/i);
  assert.equal(harness.getRow()?.updated_at, "2026-03-14T12:00:00.000Z");
});

test("admin settings API: PATCH returns normalized persisted settings and metadata", async () => {
  const harness = createSettingsQueryHarness({
    content: JSON.stringify({
      contactNotificationEmails: "",
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
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    settings?: {
      contactNotificationEmails?: string;
      dayViewBookingLimit?: number | string;
      maintenanceDueSoonKm?: number;
    };
    updatedAt?: string | null;
    updatedByEmail?: string | null;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.settings?.contactNotificationEmails, "ops@example.com, sales@example.com");
  assert.equal(payload.settings?.dayViewBookingLimit, 10);
  assert.equal(payload.settings?.maintenanceDueSoonKm, 750);
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
