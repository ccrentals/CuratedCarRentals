import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationConfigurationHealth,
  loadOperationalNotificationRoutingSummary,
  type NotificationOwnershipDirectory,
} from "@/lib/notifications/operationalRouting";

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

test("operational routing: default email is used when configured", async () => {
  const summary = await loadOperationalNotificationRoutingSummary(
    {
      primaryAdminUserId: null,
      primaryDeveloperUserId: null,
      defaultOperationalNotificationEmail: "OPS@example.com",
      additionalOperationalNotificationEmails: [],
    },
    {
      ownership: makeOwnershipDirectory(),
    },
  );

  assert.deepEqual(summary.configuredRecipients, ["ops@example.com"]);
  assert.deepEqual(summary.effectiveRecipients, ["ops@example.com"]);
  assert.equal(summary.usesFallback, false);
});

test("operational routing: additional recipients are normalized and deduped", async () => {
  const summary = await loadOperationalNotificationRoutingSummary(
    {
      primaryAdminUserId: null,
      primaryDeveloperUserId: null,
      defaultOperationalNotificationEmail: "",
      additionalOperationalNotificationEmails: [
        "fleet@example.com",
        "Ops@example.com",
        "fleet@example.com",
      ],
    },
    {
      ownership: makeOwnershipDirectory(),
    },
  );

  assert.deepEqual(summary.configuredRecipients, ["fleet@example.com", "ops@example.com"]);
  assert.deepEqual(summary.effectiveRecipients, ["fleet@example.com", "ops@example.com"]);
  assert.equal(summary.usesFallback, false);
});

test("operational routing: configured default and additional recipients merge cleanly", async () => {
  const summary = await loadOperationalNotificationRoutingSummary(
    {
      primaryAdminUserId: "admin-user-id",
      primaryDeveloperUserId: "developer-user-id",
      defaultOperationalNotificationEmail: "ops@example.com",
      additionalOperationalNotificationEmails: ["dispatch@example.com", "ops@example.com"],
    },
    {
      ownership: makeOwnershipDirectory({
        primaryAdmin: {
          kind: "primaryAdmin",
          userId: "admin-user-id",
          status: "valid",
          email: "admin@example.com",
          fullName: "Admin User",
          username: null,
          role: "ADMIN",
          roleLabel: "Admin",
          label: "Admin User",
          isLocked: false,
          message: "Primary admin account is valid.",
        },
      }),
    },
  );

  assert.deepEqual(summary.effectiveRecipients, ["ops@example.com", "dispatch@example.com"]);
  assert.equal(summary.usesFallback, false);
});

test("operational routing: empty config falls back to ownership and env", async () => {
  const ownershipFallback = await loadOperationalNotificationRoutingSummary(
    {
      primaryAdminUserId: "admin-user-id",
      primaryDeveloperUserId: null,
      defaultOperationalNotificationEmail: "",
      additionalOperationalNotificationEmails: [],
    },
    {
      ownership: makeOwnershipDirectory({
        primaryAdmin: {
          kind: "primaryAdmin",
          userId: "admin-user-id",
          status: "valid",
          email: "admin@example.com",
          fullName: "Admin User",
          username: null,
          role: "ADMIN",
          roleLabel: "Admin",
          label: "Admin User",
          isLocked: false,
          message: "Primary admin account is valid.",
        },
      }),
    },
  );

  assert.deepEqual(ownershipFallback.effectiveRecipients, ["admin@example.com"]);
  assert.equal(ownershipFallback.usesFallback, true);

  const envFallback = await loadOperationalNotificationRoutingSummary(
    {
      primaryAdminUserId: null,
      primaryDeveloperUserId: null,
      defaultOperationalNotificationEmail: "",
      additionalOperationalNotificationEmails: [],
    },
    {
      ownership: makeOwnershipDirectory(),
      adminNotifyEmailsEnv: "ops@example.com, dispatch@example.com",
      internalNotesEmailEnv: "notes@example.com",
    },
  );

  assert.deepEqual(envFallback.effectiveRecipients, ["ops@example.com", "dispatch@example.com"]);
  assert.equal(envFallback.usesFallback, true);
});

test("operational routing: configuration health warns on missing ownership and unresolved warning emails", () => {
  const health = buildNotificationConfigurationHealth({
    ownership: makeOwnershipDirectory(),
    routing: {
      configuredRecipients: [],
      effectiveRecipients: [],
      recipients: [],
      hasConfiguredRecipients: false,
      usesFallback: false,
      warnings: ["No valid operational notification recipients are configured."],
    },
    warningEmailsEnabled: true,
  });

  assert.equal(health.status, "needs-review");
  assert.match(health.warnings.join(" "), /No primary admin account selected/i);
  assert.match(health.warnings.join(" "), /No primary developer account selected/i);
  assert.match(
    health.warnings.join(" "),
    /Enable vehicle inspection warning emails only after at least one valid operational recipient resolves/i,
  );
});

test("operational routing: configuration health warns when a valid owner is locked", () => {
  const health = buildNotificationConfigurationHealth({
    ownership: makeOwnershipDirectory({
      primaryAdmin: {
        kind: "primaryAdmin",
        userId: "admin-1",
        status: "valid",
        email: "admin@example.com",
        fullName: "Admin User",
        username: null,
        role: "ADMIN",
        roleLabel: "Admin",
        label: "Admin User",
        isLocked: true,
        message: "Primary admin account is valid.",
      },
    }),
    routing: {
      configuredRecipients: ["ops@example.com"],
      effectiveRecipients: ["ops@example.com"],
      recipients: [
        {
          email: "ops@example.com",
          source: "configured-default",
          label: "Default operational email",
        },
      ],
      hasConfiguredRecipients: true,
      usesFallback: false,
      warnings: [],
    },
  });

  assert.equal(health.status, "needs-review");
  assert.match(health.warnings.join(" "), /Primary admin account is locked/i);
});
