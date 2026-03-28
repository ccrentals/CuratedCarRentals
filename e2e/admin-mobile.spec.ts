import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";

function skipIfNotMobile(testInfo: TestInfo) {
  const viewport = (testInfo.project.use as { viewport?: { width?: number } }).viewport;
  const width = viewport?.width ?? 0;
  test.skip(width > 430, "Mobile viewport coverage only.");
}

async function assertNoHorizontalOverflow(page: Page, tolerance = 2) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + tolerance);
}

test("@nightly vehicles mobile list shows cards and mobile sort control", async ({ page }, testInfo) => {
  skipIfNotMobile(testInfo);
  await authenticateAdmin(page, { allowRandomActor: true });
  await page.goto("/admin/vehicles", { waitUntil: "networkidle" });

  await expect(page.locator('[data-testid="vehicles-mobile-sort-by"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicles-mobile-sort-dir"]')).toBeVisible();

  const cards = page.locator('[data-testid="vehicle-mobile-card"]');
  await expect(cards.first()).toBeVisible();

  await page.locator('[data-testid="vehicles-mobile-sort-by"]').selectOption("status");
  await expect(page).toHaveURL(/sortBy=status/);
  await page.locator('[data-testid="vehicles-mobile-sort-dir"]').click();
  await expect(page).toHaveURL(/sortDir=(asc|desc)/);

  await assertNoHorizontalOverflow(page);
});

test("@nightly vehicle detail tabs switch and files UI is visible on mobile", async ({ page }, testInfo) => {
  skipIfNotMobile(testInfo);
  await authenticateAdmin(page, { allowRandomActor: true });
  await page.goto("/admin/vehicles", { waitUntil: "networkidle" });

  const viewButtons = page.locator('[data-testid="vehicle-mobile-view"]');
  test.skip((await viewButtons.count()) < 1, "No vehicle rows available for detail test.");

  await viewButtons.first().click();
  await expect(page.locator('[data-testid="vehicle-detail-tab-overview"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-detail-tab-files"]')).toBeVisible();

  await page.locator('[data-testid="vehicle-detail-tab-files"]').click();
  await expect(page.locator('[data-testid="vehicle-files-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-files-upload-button"]')).toBeVisible();

  const fileCards = page.locator('[data-testid="vehicle-file-card"]:visible');
  const emptyFilesState = page.getByText("No files in this folder.");
  await expect
    .poll(
      async () => (await fileCards.count()) + (await emptyFilesState.count()),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  if ((await fileCards.count()) < 1) {
    await expect(emptyFilesState).toBeVisible();
  }

  await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
  await expect(page.getByRole("heading", { name: "Blockouts" })).toBeVisible();
  await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
  await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();
  await page.locator('[data-testid="vehicle-detail-tab-depreciation"]').click();
  await expect(page.locator('[data-testid="vehicle-depreciation-panel"]')).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("@nightly quotes mobile list and quote detail actions are visible", async ({ page }, testInfo) => {
  skipIfNotMobile(testInfo);
  await authenticateAdmin(page, { allowRandomActor: true });
  await page.goto("/admin/bookings/quotes", { waitUntil: "networkidle" });

  await expect(page.locator('[data-testid="quotes-mobile-sort-by"]')).toBeVisible();
  await expect(page.locator('[data-testid="quotes-mobile-sort-dir"]')).toBeVisible();
  await page.locator('[data-testid="quotes-mobile-sort-by"]').selectOption("total");
  await expect(page).toHaveURL(/sortBy=total/);

  const quoteCards = page.locator('[data-testid="quote-mobile-card"]');
  test.skip((await quoteCards.count()) < 1, "No quote rows available for mobile detail test.");

  await quoteCards.first().getByRole("link", { name: "View" }).click();
  await expect(page.getByRole("link", { name: "Back to quotes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Print" })).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email" })).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("@nightly maintenance mobile list renders cards and stays overflow-safe", async ({ page }, testInfo) => {
  skipIfNotMobile(testInfo);
  await authenticateAdmin(page, { allowRandomActor: true });
  await page.goto("/admin/maintenance", { waitUntil: "networkidle" });

  const cards = page.locator('[data-testid="maintenance-mobile-card"]');
  const cardCount = await cards.count();
  if (cardCount > 0) {
    await expect(cards.first()).toBeVisible();
  } else {
    const emptyState = page.getByText("No maintenance records found.");
    const tableMissing = page.getByText("Maintenance tables are not installed yet.");
    const hasEmptyState = (await emptyState.count()) > 0;
    if (hasEmptyState) {
      await expect(emptyState).toBeVisible();
    } else {
      await expect(tableMissing).toBeVisible();
    }
  }

  await assertNoHorizontalOverflow(page);
});

test("@nightly depreciation mobile list renders cards and stays overflow-safe", async ({ page }, testInfo) => {
  skipIfNotMobile(testInfo);
  await authenticateAdmin(page, { allowRandomActor: true });
  await page.goto("/admin/depreciation", { waitUntil: "networkidle" });

  const cards = page.locator('[data-testid="depreciation-mobile-card"]');
  const cardCount = await cards.count();
  if (cardCount > 0) {
    await expect(cards.first()).toBeVisible();
  } else {
    const emptyState = page.getByText("No vehicle finance records found.");
    const tableMissing = page.getByText("Depreciation tables are not installed yet.");
    const hasEmptyState = (await emptyState.count()) > 0;
    if (hasEmptyState) {
      await expect(emptyState).toBeVisible();
    } else {
      await expect(tableMissing).toBeVisible();
    }
  }

  await assertNoHorizontalOverflow(page);
});

test("@nightly mobile overflow regression at 390x625 and 430x932", async ({ page }, testInfo) => {
  skipIfNotMobile(testInfo);
  await authenticateAdmin(page, { allowRandomActor: true });

  const viewports = [
    { width: 390, height: 625 },
    { width: 430, height: 932 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    await page.goto("/admin/vehicles", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    const vehicleViewButtons = page.locator('[data-testid="vehicle-mobile-view"]');
    if ((await vehicleViewButtons.count()) > 0) {
      await vehicleViewButtons.first().click();
      await assertNoHorizontalOverflow(page);
      await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
      await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.locator('[data-testid="vehicle-detail-tab-depreciation"]').click();
      await expect(page.locator('[data-testid="vehicle-depreciation-panel"]')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.goto("/admin/vehicles", { waitUntil: "networkidle" });
    }

    await page.goto("/admin/calendar", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    await page.goto("/admin/maintenance", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    await page.goto("/admin/depreciation", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    await page.goto("/admin/bookings/quotes", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    const quoteCards = page.locator('[data-testid="quote-mobile-card"]');
    if ((await quoteCards.count()) > 0) {
      await quoteCards.first().getByRole("link", { name: "View" }).click();
      await assertNoHorizontalOverflow(page);
    }
  }
});
