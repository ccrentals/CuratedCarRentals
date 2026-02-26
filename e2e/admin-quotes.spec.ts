import { createHmac, randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";

async function isVisible(locator: Locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function signIn(page: Page) {
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

async function openQuotesList(page: Page) {
  await page.goto("/admin/bookings/quotes", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Quotes", exact: true }).first()).toBeVisible();
}

async function firstNonEmptyOptionValue(page: Page, select: Locator, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const values = await select
      .locator("option")
      .evaluateAll((options) =>
        options
          .map((option) => {
            const element = option as HTMLOptionElement;
            return String(element.value ?? "").trim();
          })
          .filter((value) => value.length > 0),
      );

    if (values.length > 0) {
      return values[0];
    }

    await page.waitForTimeout(200);
  }

  return null;
}

async function maybeCreateQuoteFromModal(page: Page) {
  await page.getByRole("button", { name: "Create quote" }).click();
  await expect(page.getByRole("heading", { name: "Create Quote" })).toBeVisible();

  await page.getByLabel("Customer full name").fill("E2E Quote Tester");
  await page.getByLabel("Customer email").fill(`e2e+quote-${Date.now()}@example.com`);

  const pickupSelect = page.getByLabel("Pickup location", { exact: true });
  const dropoffSelect = page.getByLabel("Dropoff location", { exact: true });
  const vehicleSelect = page.getByLabel("Vehicle (available for selected window)", { exact: true });

  const pickupId = await firstNonEmptyOptionValue(page, pickupSelect);
  const dropoffId = await firstNonEmptyOptionValue(page, dropoffSelect);
  const vehicleId = await firstNonEmptyOptionValue(page, vehicleSelect);

  test.skip(!pickupId || !dropoffId || !vehicleId, "Quote creation requires seeded locations and vehicles.");

  await pickupSelect.selectOption(pickupId ?? "");
  await dropoffSelect.selectOption(dropoffId ?? "");
  await vehicleSelect.selectOption(vehicleId ?? "");

  await page.getByRole("button", { name: "Save quote" }).click();

  await page.waitForURL(/\/admin\/bookings\/quotes\/[^/]+(?:\?created=1)?$/, {
    timeout: 25_000,
  });

  await expect(page.getByRole("button", { name: "Convert to Booking" })).toBeVisible();
}

function skipIfNoDesktop(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only sort icon assertion.");
}

test("quotes list page loads", async ({ page }) => {
  await signIn(page);
  await openQuotesList(page);

  const tableVisible = await isVisible(page.getByRole("table").first());
  const mobileCardVisible = await isVisible(page.locator('[data-testid="quote-mobile-card"]').first());
  const emptyVisible = await isVisible(page.getByText("No quotes found.").first());
  const missingVisible = await isVisible(page.getByText("Quotes tables are not installed.").first());

  expect(tableVisible || mobileCardVisible || emptyVisible || missingVisible).toBe(true);
});

test("create quote flow opens and navigates to detail when options are available", async ({ page }) => {
  await signIn(page);
  await openQuotesList(page);

  const missingVisible = await isVisible(page.getByText("Quotes tables are not installed.").first());
  test.skip(missingVisible, "Quotes tables are not installed in this environment.");

  await maybeCreateQuoteFromModal(page);
});

test("quotes list uses centralized sorting controls and toggles URL sort params", async ({ page }, testInfo) => {
  skipIfNoDesktop(testInfo);

  await signIn(page);
  await openQuotesList(page);

  const missingVisible = await isVisible(page.getByText("Quotes tables are not installed.").first());
  test.skip(missingVisible, "Quotes tables are not installed in this environment.");

  const customerSort = page.getByRole("button", { name: "Sort by Customer Name" }).first();
  await expect(customerSort).toBeVisible();
  await expect(customerSort.locator("svg")).toBeVisible();

  await customerSort.click();
  await expect(page).toHaveURL(/sortBy=customer/);
  await expect(page).toHaveURL(/sortDir=asc/);

  await customerSort.click();
  await expect(page).toHaveURL(/sortBy=customer/);
  await expect(page).toHaveURL(/sortDir=desc/);
});
