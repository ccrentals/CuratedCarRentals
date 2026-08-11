import { expect, test, type Page } from "@playwright/test";

import {
  authenticateAdmin,
} from "./support/adminAuth";

async function signInViaClerkIdentifier(page: Page, identifier: string, password: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });

  const clerkNotConfigured = page.getByText("Clerk is not configured yet.");
  if ((await clerkNotConfigured.count()) > 0) {
    test.skip(true, "Clerk keys are not configured in this environment.");
  }

  const identifierInput = page
    .locator('input[name="identifier"], input[autocomplete="username"], input[id*="identifier"]')
    .first();
  await expect(identifierInput).toBeVisible();
  await identifierInput.fill(identifier);

  const passwordInput = page
    .locator('input[name="password"], input[autocomplete="current-password"]')
    .first();
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);

  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/admin"), { timeout: 25_000 });
}

test.describe("@nightly @tour admin users username + password reveal", () => {
  test("@nightly @tour admin create-user shows standard username and visible temp password", async ({ page }) => {
    await authenticateAdmin(page);
    await page.goto("/admin/users", { waitUntil: "networkidle" });

    const section = page.locator('[data-testid="create-user-section"]');
    await expect(section).toBeVisible();
    await section.locator("button[aria-expanded]").first().click();

    const email = `melody.malcolm+${Date.now()}@example.com`;
    await page.locator('[data-testid="create-user-first-name"]').fill("Melody");
    await page.locator('[data-testid="create-user-last-name"]').fill("Malcolm");
    await page.locator('[data-testid="create-user-email"]').fill(email);
    await page.locator('[data-testid="create-user-submit"]').click();

    const successPanel = page.locator('[data-testid="create-user-success-panel"]');
    await expect(successPanel).toBeVisible();
    await expect(page.locator('[data-testid="create-user-success-username"]')).toHaveText(/^mmalcolm\d*$/);

    const tempPasswordInput = page.locator('[data-testid="create-user-success-temp-password"]');
    await expect(tempPasswordInput).toBeVisible();
    await expect(tempPasswordInput).toHaveAttribute("type", "text");
    await expect.poll(() => tempPasswordInput.inputValue()).not.toEqual("");

    await page.locator('[data-testid="create-user-copy-temp-password"]').click();

    await page.locator('[data-testid="create-user-toggle-password-visibility"]').click();
    await expect(tempPasswordInput).toHaveAttribute("type", "password");
  });

  test("@nightly @tour sign-in helper warns for dotted username format", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });

    const clerkNotConfigured = page.getByText("Clerk is not configured yet.");
    if ((await clerkNotConfigured.count()) > 0) {
      test.skip(true, "Clerk keys are not configured in this environment.");
    }

    await expect(page.locator('[data-testid="sign-in-identifier-helper"]')).toBeVisible();
    const identifierInput = page
      .locator('input[name="identifier"], input[autocomplete="username"], input[id*="identifier"]')
      .first();
    await expect(identifierInput).toBeVisible();
    await identifierInput.fill("melody.malcolm");
    await expect(page.locator('[data-testid="sign-in-username-dot-hint"]')).toBeVisible();
  });

  test("@nightly @tour admin-created user is forced to set permanent password after first login", async ({
    page,
  }) => {
    await authenticateAdmin(page);
    await page.goto("/admin/users", { waitUntil: "networkidle" });

    const section = page.locator('[data-testid="create-user-section"]');
    await expect(section).toBeVisible();
    await section.locator("button[aria-expanded]").first().click();

    const stamp = Date.now();
    const email = `first.login.${stamp}@example.com`;
    await page.locator('[data-testid="create-user-first-name"]').fill("First");
    await page.locator('[data-testid="create-user-last-name"]').fill(`Login${stamp}`);
    await page.locator('[data-testid="create-user-email"]').fill(email);
    await page.locator('[data-testid="create-user-role"]').selectOption("ADMIN");
    await page.locator('[data-testid="create-user-submit"]').click();

    const successPanel = page.locator('[data-testid="create-user-success-panel"]');
    await expect(successPanel).toBeVisible();
    const username = (await page
      .locator('[data-testid="create-user-success-username"]')
      .innerText())
      .trim();
    const tempPassword = await page
      .locator('[data-testid="create-user-success-temp-password"]')
      .inputValue();

    await page.evaluate(async () => {
      await fetch("/api/security/csrf", { credentials: "include" });
      const csrfToken = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("ccr_csrf="))
        ?.split("=")[1];
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": csrfToken ? decodeURIComponent(csrfToken) : "" },
      });
    });
    await signInViaClerkIdentifier(page, username, tempPassword);

    const forceDialog = page.locator('[data-testid="force-password-dialog"]');
    await expect(forceDialog).toBeVisible();

    const newPassword = `NewPass!${stamp}`;
    await page.locator('[data-testid="force-password-new"]').fill(newPassword);
    await page.locator('[data-testid="force-password-confirm"]').fill(newPassword);
    await page.locator('[data-testid="force-password-submit"]').click();

    await expect(forceDialog).toBeHidden({ timeout: 12_000 });
    await expect(page.getByText("Curated Admin").first()).toBeVisible();
  });
});
