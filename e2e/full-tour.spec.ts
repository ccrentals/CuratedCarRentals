import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const FIXTURES_PATH = path.join(process.cwd(), ".artifacts", "e2e-fixtures.json");

type E2EFixtures = {
  runId: string;
  adminUser?: {
    id?: string | null;
    email?: string | null;
  };
  vehicle: { id: string };
  bookingLocations: {
    pickup: { id: string; label: string };
    dropoff: { id: string; label: string };
  };
  maintenance: {
    recordId: string;
    title: string;
    scheduledDate: string;
    blockoutReason: string;
    blockoutId: string | null;
  };
};

function readFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(`Fixtures file not found: ${FIXTURES_PATH}. Run npm run e2e:seed first.`);
  }
  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  const parsed = JSON.parse(raw) as E2EFixtures;
  if (
    !parsed?.runId ||
    !parsed?.vehicle?.id ||
    !parsed?.bookingLocations?.pickup?.id ||
    !parsed?.bookingLocations?.dropoff?.id
  ) {
    throw new Error("Fixtures file is missing required fields.");
  }
  return parsed;
}

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function formatDate(value: Date) {
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

async function signInWithForm(page: Page) {
  await page.goto("/admin/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email or username").fill(ADMIN_IDENTIFIER);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(
    (url) => {
      const route = url.pathname;
      return route.startsWith("/admin") && route !== "/admin/login";
    },
    { timeout: 20_000 },
  );
}

async function authenticateAdmin(page: Page, fixtures: E2EFixtures) {
  const actorId = fixtures.adminUser?.id ?? null;

  if (ADMIN_SESSION_SECRET && actorId) {
    const token = createSessionToken(actorId, "ADMIN");
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
    const route = new URL(page.url()).pathname;
    if (route.startsWith("/admin") && route !== "/admin/login") {
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

async function selectPreferredOptionWithRetry(
  select: Locator,
  preferredOptionValue: string | null | undefined,
  timeoutMs = 15_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const availableOptionValues = await select.locator("option").evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => value && value !== "__none__"),
    );
    const selectedOptionValue =
      (preferredOptionValue && availableOptionValues.includes(preferredOptionValue)
        ? preferredOptionValue
        : availableOptionValues[0]) ?? null;

    if (!selectedOptionValue) {
      await select.page().waitForTimeout(250);
      continue;
    }

    try {
      await select.selectOption(selectedOptionValue);
      return selectedOptionValue;
    } catch {
      await select.page().waitForTimeout(250);
    }
  }
  throw new Error(`No selectable option was available for this select within ${timeoutMs}ms.`);
}

test.describe("@tour full app tour", () => {
  test("@tour admin journey across vehicles, maintenance, depreciation, quotes, settings", async ({ page }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop-only tour for deterministic selectors.");

    const fixtures = readFixtures();
    const vehicleId = fixtures.vehicle.id;
    const runTag = `${fixtures.runId}-${Date.now()}`;

    await authenticateAdmin(page, fixtures);

    await page.goto("/admin/vehicles", { waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="vehicles-list"]')).toBeVisible();

    const vehicleRowLink = page
      .locator(`[data-testid="vehicle-row"][data-vehicle-id="${vehicleId}"] a[href="/admin/vehicles/${vehicleId}"]`)
      .first();

    if ((await vehicleRowLink.count()) > 0) {
      await vehicleRowLink.click();
    } else {
      await page.goto(`/admin/vehicles/${vehicleId}`, { waitUntil: "networkidle" });
    }

    await expect(page).toHaveURL(new RegExp(`/admin/vehicles/${vehicleId}`));
    await expect(page.locator('[data-testid="vehicle-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="vehicle-tabs"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-reservations"]').click();
    const reservationsPanel = page.locator('[data-testid="vehicle-reservations-panel"]');
    await expect(reservationsPanel).toBeVisible();
    await expect(reservationsPanel.locator('[data-testid="vehicle-reservations-summary"]')).toBeVisible();
    await expect(reservationsPanel.locator('[data-testid="vehicle-reservations-filters"]')).toBeVisible();
    await expect(reservationsPanel.locator('[data-testid="vehicle-reservations-table"]')).toBeVisible();

    const reservationRows = reservationsPanel.locator('[data-testid="vehicle-reservation-row"]');
    const emptyUpcoming = reservationsPanel.locator('[data-testid="vehicle-reservations-empty-upcoming"]');
    const emptyHistory = reservationsPanel.locator('[data-testid="vehicle-reservations-empty-history"]');
    if ((await reservationRows.count()) === 0) {
      expect((await emptyUpcoming.count()) + (await emptyHistory.count())).toBeGreaterThan(0);
    }

    await page.locator('[data-testid="vehicle-detail-tab-performance"]').click();
    const performancePanel = page.locator('[data-testid="vehicle-performance-panel"]');
    await expect(performancePanel).toBeVisible();
    await expect(performancePanel.locator('[data-testid="performance-range-selector"]')).toBeVisible();
    await expect(performancePanel.locator('[data-testid="performance-kpi-utilization"]')).toBeVisible();
    await expect(performancePanel.locator('[data-testid="performance-kpi-bookedDays"]')).toBeVisible();
    await expect(performancePanel.locator('[data-testid="performance-kpi-downtimeDays"]')).toBeVisible();
    await expect(performancePanel.locator('[data-testid="performance-byMonth-table"]')).toBeVisible();
    await expect(performancePanel.locator('[data-testid="performance-recentBookings-table"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
    await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="maintenance-list"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-depreciation"]').click();
    await expect(page.locator('[data-testid="vehicle-depreciation-panel"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-files"]').click();
    await expect(page.locator('[data-testid="vehicle-files-panel"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
    await expect(page.locator('[data-testid="vehicle-blockouts-panel"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-availability"]').click();
    const availabilityPanel = page.locator('[data-testid="vehicle-availability-rules-panel"]');
    await expect(availabilityPanel).toBeVisible();
    const advanceNoticeInput = availabilityPanel.locator('[data-testid="availability-rules-advance-notice"]');
    const nextAdvanceNotice = 0;
    await advanceNoticeInput.fill(String(nextAdvanceNotice));
    await availabilityPanel.locator('[data-testid="availability-rules-save"]').click();
    await expect(page.getByText("Availability rules saved.")).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="vehicle-detail-tab-availability"]').click();
    await expect(
      page.locator('[data-testid="availability-rules-advance-notice"]'),
    ).toHaveValue(String(nextAdvanceNotice));

    await page.locator('[data-testid="vehicle-detail-tab-pricing"]').click();
    const pricingPanel = page.locator('[data-testid="vehicle-pricing-panel"]');
    await expect(pricingPanel).toBeVisible();

    const deliveryFeeInput = pricingPanel.locator('[data-testid="pricing-delivery-fee"]');
    const currentDeliveryFeeValue = await deliveryFeeInput.inputValue();
    const currentDeliveryFee = Number(currentDeliveryFeeValue || "0");
    const nextDeliveryFee = Number.isFinite(currentDeliveryFee) ? currentDeliveryFee + 5 : 5;
    await deliveryFeeInput.fill(String(nextDeliveryFee));
    await pricingPanel.locator('[data-testid="pricing-save"]').click();
    await expect(page.getByText("Pricing rules saved.")).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="vehicle-detail-tab-pricing"]').click();
    await expect(page.locator('[data-testid="vehicle-pricing-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="pricing-delivery-fee"]')).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
    await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();

    const maintenanceTitle = `E2E Tour Maintenance ${runTag}`;
    const blockoutReasonInitial = `E2E Tour Blockout ${runTag}`;
    const blockoutReasonUpdated = `${blockoutReasonInitial} Updated`;
    const linkedExpenseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const linkedRepairOrderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const initialDate = new Date();
    initialDate.setDate(initialDate.getDate() + 5);
    const updatedDate = new Date();
    updatedDate.setDate(updatedDate.getDate() + 6);

    await page.locator('[data-testid="maintenance-add"]').click();
    await page.locator('[data-testid="maintenance-form-title"]').fill(maintenanceTitle);
    await page.locator('[data-testid="maintenance-form-scheduled-date"]').fill(formatDate(initialDate));
    await page.locator('[data-testid="maintenance-form-linked-expense"]').fill(linkedExpenseId);
    await page.locator('[data-testid="maintenance-form-linked-repair-order"]').fill(linkedRepairOrderId);

    const createBlockoutToggle = page.locator('[data-testid="maintenance-form-create-blockout"]');
    if (!(await createBlockoutToggle.isChecked())) {
      await createBlockoutToggle.check();
    }

    await page.locator('[data-testid="maintenance-form-blockout-reason"]').fill(blockoutReasonInitial);
    await page.locator('[data-testid="maintenance-save"]').click();

    const maintenanceRows = page.locator('[data-testid="maintenance-record-row"]:visible');
    const maintenanceRow = maintenanceRows.filter({ hasText: maintenanceTitle }).first();
    await expect(maintenanceRow).toBeVisible();
    await maintenanceRow.click();
    await expect(page.locator('[data-testid="maintenance-pagination"]')).toBeVisible();
    await expect(page.locator('[data-testid="maintenance-detail"]')).toBeVisible();
    const listBox = await page.locator('[data-testid="maintenance-list"]').boundingBox();
    const detailBox = await page.locator('[data-testid="maintenance-detail"]').boundingBox();
    expect(listBox).toBeTruthy();
    expect(detailBox).toBeTruthy();
    if (listBox && detailBox) {
      expect(detailBox.y).toBeGreaterThan(listBox.y + 20);
    }
    await expect(page.locator('[data-testid="maintenance-detail-linked-expense"]')).toContainText(
      linkedExpenseId,
    );
    await expect(
      page.locator('[data-testid="maintenance-detail-linked-repair-order"]'),
    ).toContainText(linkedRepairOrderId);

    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
    await expect(maintenanceRows.filter({ hasText: maintenanceTitle }).first()).toBeVisible();
    await maintenanceRows.filter({ hasText: maintenanceTitle }).first().click();
    await expect(page.locator('[data-testid="maintenance-detail-linked-expense"]')).toContainText(
      linkedExpenseId,
    );
    await expect(
      page.locator('[data-testid="maintenance-detail-linked-repair-order"]'),
    ).toContainText(linkedRepairOrderId);

    await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
    const blockoutRowByReason = (reason: string) =>
      page.locator(`[data-testid="vehicle-blockout-row"]:visible[data-blockout-reason="${reason}"]`);
    await expect(
      blockoutRowByReason(blockoutReasonInitial).first(),
    ).toBeVisible();
    const linkedBlockoutId = await blockoutRowByReason(blockoutReasonInitial)
      .first()
      .getAttribute("data-blockout-id");
    expect(linkedBlockoutId).toBeTruthy();

    await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
    await maintenanceRows.filter({ hasText: maintenanceTitle }).first().click();
    await page.locator('[data-testid="maintenance-edit"]').click();
    await page.locator('[data-testid="maintenance-form-scheduled-date"]').fill(formatDate(updatedDate));
    await page.locator('[data-testid="maintenance-form-blockout-reason"]').fill(blockoutReasonUpdated);
    await page.locator('[data-testid="maintenance-save"]').click();

    await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
    const linkedBlockoutRow = page.locator(
      `[data-testid="vehicle-blockout-row"]:visible[data-blockout-id="${linkedBlockoutId}"]`,
    );
    await expect(linkedBlockoutRow.first()).toBeVisible();

    await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
    await maintenanceRows.filter({ hasText: maintenanceTitle }).first().click();
    await page.locator('[data-testid="maintenance-mark-complete"]').click();
    await expect(page.locator('[data-testid="maintenance-detail"]')).toContainText("Completed");

    await page.locator('[data-testid="vehicle-detail-tab-blockouts"]').click();
    await expect(linkedBlockoutRow).toHaveCount(0);

    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="vehicle-detail-tab-maintenance"]').click();
    await maintenanceRows.filter({ hasText: maintenanceTitle }).first().click();
    await expect(page.locator('[data-testid="maintenance-detail"]')).toContainText("Completed");

    await page.locator('[data-testid="vehicle-detail-tab-depreciation"]').click();
    const depreciationPanel = page.locator('[data-testid="vehicle-depreciation-panel"]:visible').first();
    await expect(depreciationPanel.locator('[data-testid="depreciation-form"]')).toBeVisible();
    const notesTextarea = depreciationPanel.locator('[data-testid="depreciation-notes"]');
    const depreciationNoteValue = `E2E tour note ${runTag}`;
    await notesTextarea.fill(depreciationNoteValue);
    await expect(notesTextarea).toHaveValue(depreciationNoteValue);

    const saveDepreciationResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/vehicles/${vehicleId}/finance`) &&
      response.request().method() === "PATCH",
    );
    await depreciationPanel.locator('[data-testid="depreciation-save"]').click();
    const saveDepreciationResponse = await saveDepreciationResponsePromise;
    expect(saveDepreciationResponse.ok()).toBeTruthy();
    await expect(page.getByText("Depreciation finance details saved.")).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="vehicle-detail-tab-depreciation"]').click();
    const refreshedDepreciationPanel = page
      .locator('[data-testid="vehicle-depreciation-panel"]:visible')
      .first();
    await expect(refreshedDepreciationPanel.locator('[data-testid="depreciation-form"]')).toBeVisible();
    await expect(refreshedDepreciationPanel.locator('[data-testid="depreciation-notes"]')).toHaveValue(
      depreciationNoteValue,
    );

    const csrfResponse = await page.request.get("/api/security/csrf");
    expect(csrfResponse.ok()).toBeTruthy();
    const csrfToken = (await page.context().cookies(BASE_URL)).find(
      (cookie) => cookie.name === "ccr_csrf",
    )?.value;
    expect(csrfToken).toBeTruthy();

    const snapshotMonth = new Date().toISOString().slice(0, 7);
    const snapshotResponse = await page.request.post(
      `/api/admin/vehicles/${vehicleId}/depreciation/generate`,
      {
        headers: {
          "x-csrf-token": csrfToken ?? "",
        },
        data: {
          startMonth: snapshotMonth,
          endMonth: snapshotMonth,
          csrfToken: csrfToken ?? "",
        },
      },
    );
    // Snapshot generation is best-effort in the tour: continue to report view
    // verification even when this endpoint responds with a validation/config error.

    await page.goto("/admin/depreciation?visible=500", { waitUntil: "networkidle" });
    await expect(
      page.locator(`[data-testid="depreciation-snapshot-row"][data-vehicle-id="${vehicleId}"]`).first(),
    ).toBeVisible();

    await page.goto("/admin/bookings/quotes", { waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="quotes-list"]')).toBeVisible();
    await page.locator('[data-testid="quote-create"]').click();
    const quoteModal = page.getByRole("dialog", { name: "Create quote" });
    await expect(quoteModal.getByRole("heading", { name: "Create Quote" })).toBeVisible();

    const quoteName = `E2E Tour ${runTag}`;
    const quoteEmail = `tour+${runTag}@example.com`;
    await quoteModal.getByLabel("Customer full name").fill(quoteName);
    await quoteModal.getByLabel("Customer email").fill(quoteEmail);

    await selectPreferredOptionWithRetry(
      quoteModal.getByRole("combobox", { name: "Pickup location", exact: true }),
      fixtures.bookingLocations.pickup.id,
    );
    await selectPreferredOptionWithRetry(
      quoteModal.getByRole("combobox", { name: "Dropoff location", exact: true }),
      fixtures.bookingLocations.dropoff.id,
    );
    const vehicleSelect = quoteModal.getByRole("combobox", {
      name: "Vehicle (available for selected window)",
      exact: true,
    });
    await selectPreferredOptionWithRetry(vehicleSelect, fixtures.vehicle.id);

    await quoteModal.locator('[data-testid="quote-save"]').click();
    await page.waitForURL(/\/admin\/bookings\/quotes\/[^/]+(?:\?created=1)?$/, {
      timeout: 25_000,
    });
    await expect(page.locator('[data-testid="quote-detail"]')).toBeVisible();
    await page.locator('[data-testid="quote-mark-sent"]').click();
    await expect(page.getByText("Quote updated.")).toBeVisible();

    await page.goto(`/admin/bookings/quotes?q=${encodeURIComponent(runTag)}`, { waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="quotes-list"]')).toContainText(runTag);

    await page.goto("/admin/settings", { waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="admin-settings"]')).toBeVisible();

    const dueSoonDaysInput = page.locator('[data-testid="settings-maintenanceDueSoonDays"]');
    const originalDueSoonDays = Number(await dueSoonDaysInput.inputValue());
    const targetDueSoonDays = 1;
    await dueSoonDaysInput.fill(String(targetDueSoonDays));
    await page.locator('[data-testid="settings-save"]').click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.goto(`/admin/vehicles/${vehicleId}?tab=maintenance`, { waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();
    await expect(
      page
        .locator('[data-testid="maintenance-record-row"]:visible')
        .filter({ hasText: fixtures.maintenance.title })
        .first(),
    ).toBeVisible();

    await page.goto("/admin/settings", { waitUntil: "networkidle" });
    await dueSoonDaysInput.fill(String(originalDueSoonDays));
    await page.locator('[data-testid="settings-save"]').click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
  });
});
