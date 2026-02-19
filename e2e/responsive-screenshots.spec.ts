import { expect, test } from "@playwright/test";

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/", name: "home" },
  { path: "/fleet", name: "fleet" },
  { path: "/book", name: "book" },
  { path: "/contact", name: "contact" },
];

for (const route of ROUTES) {
  test(`responsive snapshot: ${route.name}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}
