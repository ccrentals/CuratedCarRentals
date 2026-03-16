import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import { DEFAULT_ADMIN_SETTINGS } from "@/lib/adminSettings";
import type {
  NotificationConfigurationHealth,
  NotificationOwnershipDirectory,
  OperationalNotificationRoutingSummary,
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
    primaryAdminOptions: [
      {
        id: "admin-1",
        email: "admin@example.com",
        fullName: "Admin User",
        username: null,
        role: "ADMIN",
        roleLabel: "Admin",
        label: "Admin User (admin@example.com) — Admin",
      },
    ],
    primaryDeveloperOptions: [
      {
        id: "developer-1",
        email: "developer@example.com",
        fullName: "Developer User",
        username: null,
        role: "DEVELOPER",
        roleLabel: "Developer",
        label: "Developer User (developer@example.com) — Developer",
      },
    ],
    ...overrides,
  };
}

function makeOperationalRouting(
  overrides: Partial<OperationalNotificationRoutingSummary> = {},
): OperationalNotificationRoutingSummary {
  return {
    configuredRecipients: [],
    effectiveRecipients: [],
    recipients: [],
    hasConfiguredRecipients: false,
    usesFallback: false,
    warnings: ["No valid operational notification recipients are configured."],
    ...overrides,
  };
}

function makeConfigurationHealth(
  overrides: Partial<NotificationConfigurationHealth> = {},
): NotificationConfigurationHealth {
  return {
    status: "needs-review",
    warnings: ["No valid operational notification recipients are configured."],
    ...overrides,
  };
}

test("admin settings form notifications tab: renders ownership and routing sections", () => {
  const markup = renderToStaticMarkup(
    <AdminSettingsForm
      initialSettings={DEFAULT_ADMIN_SETTINGS}
      initialOwnership={makeOwnershipDirectory()}
      initialOperationalRouting={makeOperationalRouting()}
      initialConfigurationHealth={makeConfigurationHealth()}
      updatedAt={null}
      updatedByEmail={null}
      activeTab="notifications"
      effectiveAuthLoginMethod="clerk"
      authLoginMethodSource="db"
    />,
  );

  assert.match(markup, /Operational notification readiness/);
  assert.match(markup, /Notification ownership/);
  assert.match(markup, /Operational notification routing/);
  assert.match(markup, /Primary admin account/);
  assert.match(markup, /Primary developer account/);
});

test("admin settings form notifications tab: shows status and fallback warnings", () => {
  const markup = renderToStaticMarkup(
    <AdminSettingsForm
      initialSettings={{
        ...DEFAULT_ADMIN_SETTINGS,
        defaultOperationalNotificationEmail: "",
        additionalOperationalNotificationEmails: [],
      }}
      initialOwnership={makeOwnershipDirectory({
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
      })}
      initialOperationalRouting={makeOperationalRouting()}
      initialConfigurationHealth={makeConfigurationHealth({
        status: "needs-review",
        warnings: [
          "The selected primary admin account no longer exists.",
          "No valid operational notification recipients are configured.",
        ],
      })}
      updatedAt={null}
      updatedByEmail={null}
      activeTab="notifications"
      effectiveAuthLoginMethod="clerk"
      authLoginMethodSource="db"
    />,
  );

  assert.match(markup, /Needs review/);
  assert.match(markup, /Wrong role|Inactive|Unavailable|Missing/);
  assert.match(markup, /The selected primary admin account no longer exists/);
  assert.match(markup, /No valid operational notification recipients are configured/);
});

test("admin settings form notifications tab: shows configured recipient preview", () => {
  const markup = renderToStaticMarkup(
    <AdminSettingsForm
      initialSettings={{
        ...DEFAULT_ADMIN_SETTINGS,
        defaultOperationalNotificationEmail: "ops@example.com",
        additionalOperationalNotificationEmails: ["fleet@example.com"],
      }}
      initialOwnership={makeOwnershipDirectory()}
      initialOperationalRouting={makeOperationalRouting({
        configuredRecipients: ["ops@example.com", "fleet@example.com"],
        effectiveRecipients: ["ops@example.com", "fleet@example.com"],
        recipients: [
          {
            email: "ops@example.com",
            source: "configured-default",
            label: "Default operational email",
          },
          {
            email: "fleet@example.com",
            source: "configured-additional",
            label: "Additional operational recipient",
          },
        ],
        hasConfiguredRecipients: true,
        usesFallback: false,
        warnings: [],
      })}
      initialConfigurationHealth={makeConfigurationHealth({
        status: "ready",
        warnings: [],
      })}
      updatedAt={null}
      updatedByEmail={null}
      activeTab="notifications"
      effectiveAuthLoginMethod="clerk"
      authLoginMethodSource="db"
    />,
  );

  assert.match(markup, /Configured recipients/);
  assert.match(markup, /ops@example\.com/);
  assert.match(markup, /fleet@example\.com/);
  assert.match(markup, /Default operational email/);
  assert.match(markup, /Additional operational recipient/);
});

test("admin settings form notifications tab: shows locked ownership health warnings", () => {
  const markup = renderToStaticMarkup(
    <AdminSettingsForm
      initialSettings={DEFAULT_ADMIN_SETTINGS}
      initialOwnership={makeOwnershipDirectory({
        primaryAdmin: {
          kind: "primaryAdmin",
          userId: "admin-1",
          status: "valid",
          email: "admin@example.com",
          fullName: "Admin User",
          username: null,
          role: "ADMIN",
          roleLabel: "Admin",
          label: "Admin User (admin@example.com) — Admin",
          isLocked: true,
          message: "Primary admin account is valid.",
        },
      })}
      initialOperationalRouting={makeOperationalRouting({
        effectiveRecipients: ["ops@example.com"],
        recipients: [
          {
            email: "ops@example.com",
            source: "configured-default",
            label: "Default operational email",
          },
        ],
        warnings: [],
      })}
      initialConfigurationHealth={makeConfigurationHealth({
        status: "needs-review",
        warnings: [
          "Primary admin account is locked. Review the ownership assignment before relying on fallback delivery.",
        ],
      })}
      updatedAt={null}
      updatedByEmail={null}
      activeTab="notifications"
      effectiveAuthLoginMethod="clerk"
      authLoginMethodSource="db"
    />,
  );

  assert.match(markup, /Needs review/);
  assert.match(markup, /Primary admin account is locked/);
});
