import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";

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
  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    "Set E2E admin login credentials.",
  );
  await signInWithForm(page);
}

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

test.describe("@tour admin users username + password reveal", () => {
  test("@tour admin create-user shows standard username and visible temp password", async ({ page }) => {
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
    await expect(page.getByRole("status", { name: "Copied" })).toBeVisible();

    await page.locator('[data-testid="create-user-toggle-password-visibility"]').click();
    await expect(tempPasswordInput).toHaveAttribute("type", "password");
  });

  test("@tour sign-in helper warns for dotted username format", async ({ page }) => {
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

  test("@tour admin-created user is forced to set permanent password after first login", async ({
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

    await page.goto("/api/admin/logout", { waitUntil: "domcontentloaded" });
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
