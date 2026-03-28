import { expect, test } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";
import { readE2EFixtures } from "./support/fixtures";

type E2EFixtures = {
  adminUser?: { id?: string | null };
  vehicle: { id: string };
};

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.describe("@nightly @tour vehicle maintenance drawer", () => {
  for (const viewport of VIEWPORTS) {
    test(`@nightly @tour add maintenance drawer opens/closes (${viewport.name})`, async ({ page }) => {
      const fixtures = readE2EFixtures<E2EFixtures>();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });

      await page.goto(`/admin/vehicles/${fixtures.vehicle.id}?tab=maintenance`, { waitUntil: "networkidle" });
      await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();

      await page.locator('[data-testid="maintenance-add"]').click();
      const drawer = page.locator('[data-testid="maintenance-form-drawer"]');
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute("data-vaul-drawer-direction", "right");

      await page.getByLabel("Close add maintenance drawer").click();
      await expect(drawer).toBeHidden();

      await page.locator('[data-testid="maintenance-add"]').click();
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();

      await page.locator('[data-testid="maintenance-add"]').click();
      await expect(drawer).toBeVisible();
      const currentBox = await drawer.boundingBox();
      if (currentBox && currentBox.x > 32) {
        await page.mouse.click(8, Math.max(8, Math.round(currentBox.y + 12)));
        await expect(drawer).toBeHidden();
      }
    });
  }
});
