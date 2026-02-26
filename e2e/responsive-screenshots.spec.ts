import { expect, test } from "@playwright/test";

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/", name: "home" },
  { path: "/fleet", name: "fleet" },
  { path: "/book", name: "book" },
  { path: "/contact", name: "contact" },
];

const runVisual = process.env.E2E_VISUAL === "1";

test.describe("visual @visual", () => {
  test.skip(!runVisual, "Visual snapshots are opt-in. Set E2E_VISUAL=1.");

  for (const route of ROUTES) {
    test(`responsive snapshot: ${route.name}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {
        // Some pages keep background requests open; best-effort settle only.
      });
      await page.waitForTimeout(250);

      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }
});
