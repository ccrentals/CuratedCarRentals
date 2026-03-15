import { createHmac, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";

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

test("admin create booking modal aligns flow with dates, locations, availability, and preview", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertions.");

  const availableVehicleId = "11111111-1111-4111-8111-111111111111";
  const alternateVehicleId = "33333333-3333-4333-8333-333333333333";
  let lastAvailableVehiclesQuery = "";
  let createPayload: Record<string, unknown> | null = null;

  await page.route("**/api/admin/booking-locations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        locations: [
          {
            id: "pickup-airport",
            label: "Montego Bay Airport",
            allow_pickup: true,
            allow_dropoff: true,
            is_active: true,
          },
          {
            id: "pickup-kingston",
            label: "Kingston Office",
            allow_pickup: true,
            allow_dropoff: true,
            is_active: true,
          },
        ],
      }),
    });
  });

  await page.route("**/api/admin/bookings/available-vehicles?*", async (route) => {
    const url = new URL(route.request().url());
    lastAvailableVehiclesQuery = url.search;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        vehicles: [
          {
            id: availableVehicleId,
            label: "2026 Toyota Corolla",
            year: 2026,
            make: "Toyota",
            model: "Corolla",
            dailyRateCents: 12000,
            depositCents: 25000,
          },
          {
            id: alternateVehicleId,
            label: "2026 Honda Fit",
            year: 2026,
            make: "Honda",
            model: "Fit",
            dailyRateCents: 14000,
            depositCents: 40000,
          },
        ],
      }),
    });
  });

  await page.route("**/api/admin/bookings/preview?*", async (route) => {
    const url = new URL(route.request().url());
    const selectedVehicleId = url.searchParams.get("vehicleId");
    const isAlternateVehicle = selectedVehicleId === alternateVehicleId;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        preview: {
          days: 3,
          dailyRateCents: isAlternateVehicle ? 14000 : 12000,
          subtotalCents: isAlternateVehicle ? 42000 : 36000,
          promoDiscountCents: 0,
          totalCents: isAlternateVehicle ? 42000 : 36000,
          depositRequiredCents: isAlternateVehicle ? 40000 : 25000,
          currency: "JMD",
        },
      }),
    });
  });

  await page.route("**/api/admin/bookings", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    createPayload = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Vehicle unavailable for selected dates" }),
    });
  });

  await signIn(page);
  await page.goto("/admin/bookings?create=1", { waitUntil: "networkidle" });

  const dialog = page.getByRole("dialog", { name: "Create booking" });
  await expect(dialog).toBeVisible();

  const startDate = dialog.getByLabel("Start date");
  const pickupLocation = dialog.getByLabel("Pickup location");
  const vehicle = dialog.getByLabel("Vehicle");
  const startBox = await startDate.boundingBox();
  const pickupBox = await pickupLocation.boundingBox();
  const vehicleBox = await vehicle.boundingBox();

  expect(startBox?.y ?? 0).toBeLessThan(pickupBox?.y ?? 0);
  expect(pickupBox?.y ?? 0).toBeLessThan(vehicleBox?.y ?? 0);

  const pickupOptions = await pickupLocation.locator("option").allTextContents();
  expect(pickupOptions).toContain("Montego Bay Airport");
  expect(pickupOptions).toContain("Kingston Office");

  await startDate.fill("2099-04-10");
  await dialog.getByLabel("End date").fill("2099-04-12");

  await expect
    .poll(() => lastAvailableVehiclesQuery, {
      message: "available vehicles should be reloaded when dates change",
    })
    .toContain("startDate=2099-04-10");
  await expect
    .poll(() => lastAvailableVehiclesQuery, {
      message: "available vehicles should include the selected end date",
    })
    .toContain("endDate=2099-04-12");

  const vehicleOptions = await vehicle.locator("option").allTextContents();
  expect(vehicleOptions).toContain("2026 Toyota Corolla");
  expect(vehicleOptions).not.toContain("2026 Nissan Patrol");

  const recordPaymentNow = dialog.getByLabel("Record payment now");
  await expect(recordPaymentNow).toHaveAttribute("class", /accent-\[var\(--ccr-accent\)\]/);
  await recordPaymentNow.check();

  const paymentAmountInput = dialog.getByLabel("Payment amount (JMD)");
  await expect(paymentAmountInput).toBeVisible();
  await expect(paymentAmountInput).toHaveValue("");
  await expect(dialog.getByLabel("Payment method")).toBeVisible();

  await pickupLocation.selectOption("pickup-airport");
  await vehicle.selectOption(availableVehicleId);

  const preview = page.getByTestId("admin-create-booking-total-preview");
  await expect(preview).toContainText("Booking total preview");
  await expect(preview).toContainText("Days");
  await expect(preview).toContainText("3");
  await expect(preview).toContainText("Total");
  await expect(preview).toContainText("36,000.00");
  await expect
    .poll(async () => Number(await paymentAmountInput.inputValue()))
    .toBe(25000);

  await vehicle.selectOption(alternateVehicleId);
  await expect(preview).toContainText("42,000.00");
  await expect
    .poll(async () => Number(await paymentAmountInput.inputValue()))
    .toBe(40000);

  await paymentAmountInput.fill("37000");
  await vehicle.selectOption(availableVehicleId);
  await expect(preview).toContainText("36,000.00");
  await expect
    .poll(async () => Number(await paymentAmountInput.inputValue()))
    .toBe(37000);

  await dialog.getByLabel("Full name").fill("Admin Booking Tester");
  await dialog.getByLabel("Email").fill("admin-create@example.com");
  await dialog.getByLabel("Phone").fill("+18765550144");

  await dialog.getByRole("button", { name: "Create booking" }).click();

  await expect(page.getByText("Vehicle unavailable for selected dates")).toBeVisible();
  expect(createPayload?.pickupLocation).toBe("Montego Bay Airport");
});

test("admin create booking defaults end date and persists recorded payment to the booking detail page", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertions.");

  await signIn(page);
  await page.goto("/admin/bookings?create=1", { waitUntil: "networkidle" });

  const dialog = page.getByRole("dialog", { name: "Create booking" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Start date").fill("2026-05-18");
  await expect(dialog.getByLabel("End date")).toHaveValue("2026-05-20");

  const pickupLocation = dialog.getByLabel("Pickup location");
  await pickupLocation.selectOption({ index: 1 });

  const vehicle = dialog.getByLabel("Vehicle");
  await expect
    .poll(async () => {
      const options = await vehicle.locator("option").allTextContents();
      return options.filter(
        (option) =>
          option &&
          option !== "Select vehicle" &&
          !option.includes("Loading available vehicles") &&
          !option.includes("No vehicles available"),
      ).length;
    })
    .toBeGreaterThan(0);

  const preferredVehicleValue = await vehicle.locator("option").evaluateAll((options) => {
    const eligibleOption = options.find((option) => {
      const normalizedValue = (option as HTMLOptionElement).value.trim();
      const normalizedLabel = option.textContent?.trim() ?? "";
      return (
        normalizedValue.length > 0 &&
        normalizedLabel !== "Select vehicle" &&
        !normalizedLabel.includes("Loading available vehicles") &&
        !normalizedLabel.includes("No vehicles available")
      );
    }) as HTMLOptionElement | undefined;

    return eligibleOption?.value ?? "";
  });

  expect(preferredVehicleValue).toBeTruthy();
  await vehicle.selectOption(preferredVehicleValue);

  const preview = page.getByTestId("admin-create-booking-total-preview");
  await expect(preview).toContainText("Start date");
  await expect(preview).toContainText("End date");
  await expect(preview).toContainText("Days");
  await expect(preview).toContainText("3");

  const previewValues = await preview.locator("dd").allInnerTexts();
  expect(previewValues.length).toBeGreaterThanOrEqual(7);
  const paymentAmount = previewValues[5]?.replace(/[$,]/g, "") ?? "0.00";

  await dialog.getByLabel("Full name").fill("Admin create booking payment flow");
  await dialog.getByLabel("Email").fill(`admin-create-payment-${Date.now()}@example.com`);
  await dialog.getByLabel("Phone").fill("+18765550144");
  await dialog.getByLabel("Record payment now").check();
  await expect
    .poll(async () => Number(await dialog.getByLabel("Payment amount (JMD)").inputValue()))
    .toBe(Number(paymentAmount));

  await dialog.getByRole("button", { name: "Create booking" }).click();

  await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("No payments recorded yet.");
  expect(bodyText).not.toContain("Payment status\nUNPAID");
  expect(bodyText).toContain("Paid to date");
});
