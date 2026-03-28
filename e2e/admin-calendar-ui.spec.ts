import { expect, test } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";
import { readE2EFixtures } from "./support/fixtures";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

type E2EFixtures = {
  adminUser?: { id?: string | null };
  vehicle: { id: string };
};

function ymd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test.describe("@nightly @tour admin calendar UI", () => {
  for (const viewport of VIEWPORTS) {
    test(`@nightly @tour booking filters single-date picker (${viewport.name})`, async ({ page }) => {
      const fixtures = readE2EFixtures<E2EFixtures>();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });

      await page.goto("/admin/bookings", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/\/admin\/bookings/);

      const fromValue = ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 14));
      const toValue = ymd(new Date());

      const dateFromInput = page.locator('[data-testid="bookings-filter-date-from"]');
      const dateToInput = page.locator('[data-testid="bookings-filter-date-to"]');

      await expect(dateFromInput).toBeVisible();
      await expect(dateToInput).toBeVisible();

      await dateFromInput.fill(fromValue);
      await expect.poll(() => new URL(page.url()).searchParams.get("dateFrom")).toBe(fromValue);
      await dateToInput.fill(toValue);
      await expect.poll(() => new URL(page.url()).searchParams.get("dateTo")).toBe(toValue);
    });

    test(`@nightly @tour vehicle performance date-range picker (${viewport.name})`, async ({ page }) => {
      const fixtures = readE2EFixtures<E2EFixtures>();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });

      await page.goto(`/admin/vehicles/${fixtures.vehicle.id}?tab=performance`, { waitUntil: "networkidle" });

      const panel = page.locator('[data-testid="vehicle-performance-panel"]');
      await expect(panel).toBeVisible();

      await page.getByRole("button", { name: "Custom" }).first().click();
      const startInput = panel.locator('[data-testid="performance-custom-start"]');
      const endInput = panel.locator('[data-testid="performance-custom-end"]');
      await expect(startInput).toBeVisible();
      await expect(endInput).toBeVisible();

      const rangeStart = ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30));
      const rangeEnd = ymd(new Date());
      await startInput.fill(rangeStart);
      await endInput.fill(rangeEnd);
      await panel.getByRole("button", { name: "Apply" }).first().click();

      await expect(panel).not.toContainText("Custom range requires both start and end dates.");
      await expect(panel.getByText("Range pending")).toHaveCount(0);
    });
  }
});
