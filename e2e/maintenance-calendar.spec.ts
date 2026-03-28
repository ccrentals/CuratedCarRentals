import { expect, test } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";

function formatDate(value: Date) {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

test("@nightly maintenance lifecycle syncs blockouts and persists across reload", async ({ page }) => {
  await authenticateAdmin(page, { allowRandomActor: true });
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
