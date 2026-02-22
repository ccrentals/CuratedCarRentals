import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";

async function isVisible(locator: Locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function signIn(page: Page) {
  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    "Set E2E_ADMIN_IDENTIFIER (or E2E_ADMIN_EMAIL/E2E_ADMIN_USER) and E2E_ADMIN_PASSWORD (or E2E_ADMIN_PASS).",
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

  const pickupSelect = page.getByLabel("Pickup location");
  const dropoffSelect = page.getByLabel("Dropoff location");
  const vehicleSelect = page.getByLabel("Vehicle (available for selected window)");

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
  const emptyVisible = await isVisible(page.getByText("No quotes found.").first());
  const missingVisible = await isVisible(page.getByText("Quotes tables are not installed.").first());

  expect(tableVisible || emptyVisible || missingVisible).toBe(true);
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
