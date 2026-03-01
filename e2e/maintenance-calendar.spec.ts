import { createHmac, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function signInWithForm(page: Page) {
  await page.goto("/admin/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email or username").fill(ADMIN_IDENTIFIER);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(
    (url) => {
      const path = url.pathname;
      return path.startsWith("/admin") && path !== "/admin/login";
    },
    { timeout: 20_000 },
  );
}

async function authenticateAdmin(page: Page) {
  if (ADMIN_SESSION_SECRET) {
    const token = createSessionToken(randomUUID(), "ADMIN");
    await page.context().addCookies([
      {
        name: "ccr_admin_session",
        value: token,
        url: BASE_URL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin", { waitUntil: "networkidle" });
    const path = new URL(page.url()).pathname;
    if (path.startsWith("/admin") && path !== "/admin/login") {
      return;
    }
    if (!ADMIN_IDENTIFIER || !ADMIN_PASSWORD) {
      test.skip(
        true,
        "Admin cookie auth was rejected and no E2E admin login credentials were provided.",
      );
    }
  }

  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    "Set ADMIN_SESSION_SECRET or E2E admin login credentials.",
  );
  await signInWithForm(page);
}

function formatDate(value: Date) {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

test("maintenance lifecycle syncs blockouts and persists across reload", async ({ page }) => {
  await authenticateAdmin(page);
  await page.goto("/admin/vehicles", { waitUntil: "networkidle" });

  const mobileVehicleLinks = page.locator('[data-testid="vehicle-mobile-view"]:visible');
  if ((await mobileVehicleLinks.count()) > 0) {
    await mobileVehicleLinks.first().click();
  } else {
    const desktopVehicleLinks = page.locator("table tbody tr a[href^='/admin/vehicles/']:visible");
    test.skip((await desktopVehicleLinks.count()) < 1, "No vehicles available for maintenance regression test.");
    await desktopVehicleLinks.first().click();
  }

  await expect(page).toHaveURL(/\/admin\/vehicles\/[^/?]+/);
  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();

  const missingTablesNotice = page.getByText("Vehicle maintenance tables are not installed.");
  if ((await missingTablesNotice.count()) > 0) {
    test.skip(true, "Maintenance tables are not installed in this test environment.");
  }

  const stamp = Date.now();
  const recordTitle = `E2E maintenance ${stamp}`;
  const blockoutReasonInitial = `E2E maintenance blockout ${stamp}`;
  const blockoutReasonUpdated = `${blockoutReasonInitial} updated`;
  const blockoutRowByReason = (reason: string) =>
    page.locator(`[data-testid="vehicle-blockout-row"][data-blockout-reason="${reason}"]:visible`);

  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + 1);
  const scheduledDateUpdated = new Date();
  scheduledDateUpdated.setDate(scheduledDateUpdated.getDate() + 2);

  await page.locator('[data-testid="maintenance-add"]').click();
  await expect(page.locator('[data-testid="maintenance-form-drawer"]')).toBeVisible();
  await page.locator('[data-testid="maintenance-form-title"]').fill(recordTitle);
  await page.locator('[data-testid="maintenance-form-scheduled-date"]').fill(formatDate(scheduledDate));

  const createBlockoutToggle = page.locator('[data-testid="maintenance-form-create-blockout"]');
  if (!(await createBlockoutToggle.isChecked())) {
    await createBlockoutToggle.check();
  }
  await page.locator('[data-testid="maintenance-form-blockout-reason"]').fill(blockoutReasonInitial);
  await page.locator('[data-testid="maintenance-save"]').click();

  const maintenanceRow = page
    .locator('[data-testid="maintenance-record-row"]:visible')
    .filter({ hasText: recordTitle });
  await expect(maintenanceRow.first()).toBeVisible();
  await maintenanceRow.first().click();

  await expect(page.locator('[data-testid="maintenance-detail"]')).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await expect(
    page.locator('[data-testid="maintenance-record-row"]:visible').filter({ hasText: recordTitle }).first(),
  ).toBeVisible();

  await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
  await expect(page.locator('[data-testid="vehicle-blockouts-panel"]')).toBeVisible();
  await expect(blockoutRowByReason(blockoutReasonInitial).first()).toBeVisible();

  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await page
    .locator('[data-testid="maintenance-record-row"]:visible')
    .filter({ hasText: recordTitle })
    .first()
    .click();

  await page.locator('[data-testid="maintenance-edit"]').click();
  await page.locator('[data-testid="maintenance-form-scheduled-date"]').fill(formatDate(scheduledDateUpdated));

  if (!(await createBlockoutToggle.isChecked())) {
    await createBlockoutToggle.check();
  }
  await page.locator('[data-testid="maintenance-form-blockout-reason"]').fill(blockoutReasonUpdated);
  await page.locator('[data-testid="maintenance-save"]').click();

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await expect(
    page.locator('[data-testid="maintenance-record-row"]:visible').filter({ hasText: recordTitle }).first(),
  ).toBeVisible();
  await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
  await expect(blockoutRowByReason(blockoutReasonUpdated).first()).toBeVisible();
  await expect(blockoutRowByReason(blockoutReasonInitial)).toHaveCount(0);

  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await page
    .locator('[data-testid="maintenance-record-row"]:visible')
    .filter({ hasText: recordTitle })
    .first()
    .click();

  await page.locator('[data-testid="maintenance-mark-complete"]').click();
  await expect(page.locator('[data-testid="maintenance-detail"]')).toContainText("Completed");

  await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
  await expect(blockoutRowByReason(blockoutReasonUpdated)).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await expect(
    page.locator('[data-testid="maintenance-record-row"]:visible').filter({ hasText: recordTitle }).first(),
  ).toBeVisible();
  await page
    .locator('[data-testid="maintenance-record-row"]:visible')
    .filter({ hasText: recordTitle })
    .first()
    .click();
  await expect(page.locator('[data-testid="maintenance-detail"]')).toContainText("Completed");

  await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
  await expect(blockoutRowByReason(blockoutReasonUpdated)).toHaveCount(0);
});
