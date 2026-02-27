import { expect, test, type Page } from "@playwright/test";

type QuotePayload = {
  vehicleId?: string;
  startAt?: string;
  endAt?: string;
  insuranceSelected?: boolean;
  promoCode?: string | null;
  paymentOption?: "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";
};

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const HAS_TURNSTILE_SITE_KEY = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());

function calcDaysInclusive(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const diffDays = Math.floor((endUtc - startUtc) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays + 1 : 0;
}

function buildQuoteSummary(payload: QuotePayload) {
  const startAt = String(payload.startAt ?? "");
  const endAt = String(payload.endAt ?? "");
  const days = calcDaysInclusive(startAt, endAt);
  const baseTotal = days * 10_000;
  const insuranceTotal = payload.insuranceSelected ? days * 1_000 : 0;
  const subtotal = baseTotal + insuranceTotal;
  const discountTotal = String(payload.promoCode ?? "").toUpperCase() === "SAVE5" ? 5_000 : 0;
  const total = Math.max(0, subtotal - discountTotal);

  return {
    days,
    baseTotal,
    insurancePricePerDay: payload.insuranceSelected ? 1_000 : 0,
    insuranceTotal,
    discountTotal,
    subtotal,
    total,
    amountDue: total,
    depositRequired: 3_000,
    paidToDate: 0,
    balanceDue: total,
    paymentOption: payload.paymentOption ?? "DEPOSIT",
    promoCode: discountTotal > 0 ? "SAVE5" : null,
  };
}

function formatJmd(amount: number) {
  return Number(amount || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function mockBookingApis(page: Page) {
  await page.route("**/api/public/locations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        locations: [
          {
            id: "L1",
            label: "168 1/2 Old Hope Road, Kingston Jamaica",
            allow_pickup: true,
            allow_dropoff: true,
          },
        ],
      }),
    });
  });

  await page.route("**/api/public/vehicles**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        vehicles: [
          {
            id: VEHICLE_ID,
            name: "Toyota Test",
            make: "Toyota",
            model: "Yaris",
            daily_rate_cents: 10000,
            deposit_cents: 3000,
            transmission: "Automatic",
            seats: 5,
          },
        ],
      }),
    });
  });

  await page.route("**/api/public/insurance**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        insurance: {
          enabled: true,
          planId: "plan-1",
          pricePerDayCents: 1000,
        },
      }),
    });
  });

  await page.route("**/api/public/promos/validate", async (route) => {
    const body = route.request().postDataJSON() as { code?: string };
    const code = String(body?.code ?? "").trim().toUpperCase();
    if (code !== "SAVE5") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Promo code not found." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        code: "SAVE5",
        discountAmountCents: 5000,
        isEstimate: false,
      }),
    });
  });

  await page.route("**/api/public/pricing/quote", async (route) => {
    const payload = route.request().postDataJSON() as QuotePayload;
    const summary = buildQuoteSummary(payload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, summary, currency: "JMD" }),
    });
  });

  await page.route("https://upload.uploadcare.com/base/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ file: "22222222-2222-4222-8222-222222222222" }),
    });
  });
}

async function advanceToPaymentsStep(page: Page) {
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Select Vehicle" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();

  await page.getByLabel("First Name *").fill("Draft");
  await page.getByLabel("Last Name *").fill("Restore");
  await page.getByLabel("DL Number *").fill("D1234567");
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.first().setInputFiles({
    name: "dl.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-dl-image"),
  });
  await page.getByRole("button", { name: "Next Step" }).click();

  const signatureCanvas = page.locator("canvas").first();
  await signatureCanvas.click({ position: { x: 20, y: 20 } });
  await page.getByLabel("By clicking here, I confirm that I accept the privacy policy and terms.").check();
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.locator('[data-testid="booking-step-payments"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBookingApis(page);
});

test("booking requires vehicle selection before continue", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByRole("heading", { name: "Available Vehicle Classes" })).toBeVisible();

  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByText("Select a vehicle to continue.")).toBeVisible();
});

test("driver's license number and image are required before leaving customer step", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Select Vehicle" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();

  await expect(page.getByRole("heading", { name: "Customer Information" })).toBeVisible();

  await page.getByLabel("First Name *").fill("Test");
  await page.getByLabel("Last Name *").fill("Driver");
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByText("Driver's license number is required.")).toBeVisible();

  await page.getByLabel("DL Number *").fill("D1234567");
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByText("Driver's license image upload is required.")).toBeVisible();

  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.first().setInputFiles({
    name: "dl.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-dl-image"),
  });

  await expect(page.getByText("Driver's license image uploaded.")).toBeVisible();
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByRole("heading", { name: "Confirm Reservation" })).toBeVisible();
});

test("insurance and promo update totals using pricing quote", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });

  const startAt = await page
    .locator('input[type="date"]')
    .first()
    .inputValue();
  const startTime = await page
    .locator('input[type="time"]')
    .first()
    .inputValue();
  const endAt = await page
    .locator('input[type="date"]')
    .nth(1)
    .inputValue();
  const endTime = await page
    .locator('input[type="time"]')
    .nth(1)
    .inputValue();

  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Select Vehicle" }).click();
  const initialQuotePromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/public/pricing/quote")) return false;
    const body = response.request().postData() ?? "";
    return body.includes(`\"vehicleId\":\"${VEHICLE_ID}\"`) && body.includes("\"insuranceSelected\":false");
  });
  await page.getByRole("button", { name: "Next Step" }).click();

  const pricingPanel = page.locator("aside").filter({ hasText: "Pricing (JMD)" });
  const quoteBeforeJson = (await (await initialQuotePromise).json()) as { summary: { total: number } };
  await expect(pricingPanel).toContainText(formatJmd(quoteBeforeJson.summary.total));

  const quoteWithInsurancePromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/public/pricing/quote")) return false;
    const body = response.request().postData() ?? "";
    return body.includes(`\"vehicleId\":\"${VEHICLE_ID}\"`) && body.includes("\"insuranceSelected\":true");
  });
  await page.getByLabel("Add plan").check();
  const quoteWithInsuranceJson = (await (await quoteWithInsurancePromise).json()) as {
    summary: { total: number };
  };
  await expect(pricingPanel).toContainText(formatJmd(quoteWithInsuranceJson.summary.total));

  const quoteWithInsuranceAndPromoPromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/public/pricing/quote")) return false;
    const body = response.request().postData() ?? "";
    return (
      body.includes(`\"vehicleId\":\"${VEHICLE_ID}\"`) &&
      body.includes("\"insuranceSelected\":true") &&
      body.includes("\"promoCode\":\"SAVE5\"")
    );
  });
  await page.getByPlaceholder("Enter coupon code").fill("SAVE5");
  await page.getByRole("button", { name: "Apply" }).click();
  const quoteWithInsuranceAndPromoJson = (await (await quoteWithInsuranceAndPromoPromise).json()) as {
    summary: { total: number };
  };
  await expect(pricingPanel).toContainText(
    formatJmd(quoteWithInsuranceAndPromoJson.summary.total),
  );

  const expectedSummary = buildQuoteSummary({
    vehicleId: VEHICLE_ID,
    startAt: `${startAt}T${startTime}:00.000Z`,
    endAt: `${endAt}T${endTime}:00.000Z`,
    insuranceSelected: true,
    promoCode: "SAVE5",
    paymentOption: "DEPOSIT",
  });
  expect(quoteWithInsuranceAndPromoJson.summary.total).toBe(expectedSummary.total);
});

test("booking draft can be restored then cleared with start over", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToPaymentsStep(page);

  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText("Draft restored. For security, please re-upload your driver's license image and signature."),
  ).toBeVisible();

  await page.locator('[data-testid="booking-start-over"]').click();
  await expect(page.locator('[data-testid="booking-start-over-dialog"]')).toBeVisible();
  await page.locator('[data-testid="booking-start-over-confirm"]').click();

  await expect(page.locator('[data-testid="booking-step-dates"]')).toBeVisible();
  await expect(page.locator('[data-testid="booking-step-payments"]')).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText(/Draft restored\./)).toHaveCount(0);
});

test("summary shortcuts return user to date and vehicle steps", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToPaymentsStep(page);

  await page.locator('[data-testid="booking-summary-change-vehicle"]').click();
  await expect(page.locator('[data-testid="booking-step-vehicles"]')).toBeVisible();

  await page.locator('[data-testid="booking-summary-change-dates"]').click();
  await expect(page.locator('[data-testid="booking-step-dates"]')).toBeVisible();
});

test("turnstile retry guidance appears when widget script fails to load", async ({ page }) => {
  test.skip(!HAS_TURNSTILE_SITE_KEY, "Requires Turnstile site key in the test environment.");

  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToPaymentsStep(page);

  const securityPanel = page.locator('[data-testid="booking-security-check"]');
  await expect(securityPanel.locator('[data-testid="turnstile-error-message"]')).toContainText(
    "Security check couldn't load.",
  );
  await expect(securityPanel.locator('[data-testid="turnstile-retry-button"]')).toBeVisible();
});
