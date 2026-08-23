import { expect, test, type Page } from "@playwright/test";

type QuotePayload = {
  vehicleId?: string;
  startAt?: string;
  endAt?: string;
  insuranceSelected?: boolean;
  promoCode?: string | null;
  paymentOption?: "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";
  customAmount?: number | string | null;
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
  const depositRequired = 3_000;
  const requestedCustomAmount =
    payload.customAmount === null || payload.customAmount === undefined || payload.customAmount === ""
      ? null
      : Number(payload.customAmount);
  let dueNow = 0;

  if (payload.paymentOption === "DEPOSIT" || !payload.paymentOption) {
    dueNow = Math.min(total, depositRequired);
  } else if (payload.paymentOption === "FULL") {
    dueNow = total;
  } else if (
    payload.paymentOption === "CUSTOM" &&
    Number.isFinite(requestedCustomAmount) &&
    requestedCustomAmount! > 0 &&
    requestedCustomAmount! <= total
  ) {
    dueNow = Math.round(requestedCustomAmount!);
  }

  const dueOnPickup = Math.max(0, total - dueNow);
  const reserveShortfall = Math.max(0, depositRequired - dueNow);

  return {
    days,
    baseTotal,
    insurancePricePerDay: payload.insuranceSelected ? 1_000 : 0,
    insuranceTotal,
    discountTotal,
    subtotal,
    total,
    amountDue: total,
    depositRequired,
    paidToDate: 0,
    dueNow,
    dueOnPickup,
    reserveShortfall,
    balanceDue: dueOnPickup,
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

const WIZARD_DRAFT_STORAGE_KEY = "ccr_booking_wizard_draft_v1";

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
  await page.getByRole("button", { name: /^Select$/ }).first().click();
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();

  await page.getByLabel("First Name *").fill("Draft");
  await page.getByLabel("Last Name *").fill("Restore");
  await page.getByLabel("Email Address *").fill("draft.restore@example.com");
  await page.getByLabel("Phone Number *").fill("8765551234");
  await page.getByLabel("DL Number").fill("D1234567");
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

async function advanceToConfirmStep(page: Page) {
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: /^Select$/ }).first().click();
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();

  await page.getByLabel("First Name *").fill("Theme");
  await page.getByLabel("Last Name *").fill("Check");
  await page.getByLabel("Email Address *").fill("theme.check@example.com");
  await page.getByLabel("Phone Number *").fill("8765551234");
  await page.getByLabel("DL Number").fill("D1234567");
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.first().setInputFiles({
    name: "dl.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-dl-image"),
  });
  await page.getByRole("button", { name: "Next Step" }).click();

  await expect(page.getByRole("heading", { name: "Confirm Reservation" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBookingApis(page);
});

test("booking requires vehicle selection before continue", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.locator('[data-testid="booking-step-vehicles"]')).toBeVisible();

  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByText("Select a vehicle to continue.")).toBeVisible();
});

test("driver's license number, expiration date, and image are optional on customer step", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: /^Select$/ }).first().click();
  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByRole("button", { name: "Next Step" }).click();

  await expect(page.getByRole("heading", { name: "Customer Information" })).toBeVisible();

  await page.getByLabel("First Name *").fill("Test");
  await page.getByLabel("Last Name *").fill("Driver");
  await page.getByLabel("Email Address *").fill("test.driver@example.com");
  await page.getByLabel("Phone Number *").fill("8765551234");
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.getByText("Driver's license number is required.")).toHaveCount(0);
  await expect(page.getByText("Driver's license image upload is required.")).toHaveCount(0);
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
  await page.getByRole("button", { name: /^Select$/ }).first().click();
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

test("step 6 hydrates pricing quote from draft vehicle and renders non-zero totals", async ({ page }) => {
  await page.addInitScript(({ storageKey, vehicleId }) => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        step: 6,
        maxStepCompleted: 6,
        pickupDate: "2099-05-10",
        pickupTime: "10:00",
        dropoffDate: "2099-05-12",
        dropoffTime: "10:00",
        pickupLocationId: "L1",
        dropoffLocationId: "L1",
        selectedVehicleId: vehicleId,
        paymentOption: "DEPOSIT",
      }),
    );
  }, { storageKey: WIZARD_DRAFT_STORAGE_KEY, vehicleId: VEHICLE_ID });

  const quoteResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/public/pricing/quote")) return false;
    const body = response.request().postData() ?? "";
    return body.includes(`\"vehicleId\":\"${VEHICLE_ID}\"`);
  });

  await page.goto("/book", { waitUntil: "networkidle" });
  await expect(page.locator('[data-testid="booking-step-payments"]')).toBeVisible();

  const quoteResponse = await quoteResponsePromise;
  const quoteJson = (await quoteResponse.json()) as { summary: { baseTotal: number; total: number } };
  const pricingPanel = page.locator("aside").filter({ hasText: "Pricing (JMD)" });
  await expect(pricingPanel).toContainText(formatJmd(quoteJson.summary.baseTotal));
  await expect(pricingPanel).toContainText(formatJmd(quoteJson.summary.total));
});

test("step 6 shows missing vehicle warning and disables continue", async ({ page }) => {
  await page.addInitScript(({ storageKey }) => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        step: 6,
        maxStepCompleted: 6,
        pickupDate: "2099-05-10",
        pickupTime: "10:00",
        dropoffDate: "2099-05-12",
        dropoffTime: "10:00",
        pickupLocationId: "L1",
        dropoffLocationId: "L1",
        paymentOption: "DEPOSIT",
      }),
    );
  }, { storageKey: WIZARD_DRAFT_STORAGE_KEY });

  await page.goto("/book", { waitUntil: "networkidle" });
  await expect(page.locator('[data-testid="booking-step-payments"]')).toBeVisible();
  await expect(page.locator('[data-testid="booking-step6-vehicle-warning"]')).toContainText(
    "Select a vehicle to continue.",
  );
  await expect(page.locator('[data-testid="booking-continue-payment"]')).toBeDisabled();
});

test("step 6 idle stays stable without request loop", async ({ page }) => {
  test.setTimeout(120_000);

  let vehicleRequestCount = 0;
  let quoteRequestCount = 0;

  await page.unroute("**/api/public/vehicles**");
  await page.unroute("**/api/public/pricing/quote");

  await page.route("**/api/public/vehicles**", async (route) => {
    vehicleRequestCount += 1;
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

  await page.route("**/api/public/pricing/quote", async (route) => {
    quoteRequestCount += 1;
    const payload = route.request().postDataJSON() as QuotePayload;
    const summary = buildQuoteSummary(payload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, summary, currency: "JMD" }),
    });
  });

  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToPaymentsStep(page);

  const summaryPanel = page.locator("aside").filter({ hasText: "Pricing (JMD)" });
  await expect(summaryPanel).toContainText("Vehicle: Toyota Test");

  const vehicleCountBeforeIdle = vehicleRequestCount;
  const quoteCountBeforeIdle = quoteRequestCount;

  await page.waitForTimeout(75_000);

  const vehiclesDuringIdle = vehicleRequestCount - vehicleCountBeforeIdle;
  const quotesDuringIdle = quoteRequestCount - quoteCountBeforeIdle;
  const summaryText = (await summaryPanel.textContent()) ?? "";

  await expect(page.locator('[data-testid="booking-step6-vehicle-warning"]')).toHaveCount(0);
  await expect(summaryPanel).toContainText("Vehicle: Toyota Test");
  expect(summaryText).not.toMatch(/Total\s*\$0\.00/);
  expect(vehiclesDuringIdle).toBeLessThanOrEqual(3);
  expect(quotesDuringIdle).toBeLessThanOrEqual(3);
});

test("restored unavailable vehicle is retained until explicitly deselected", async ({ page }) => {
  const unavailableVehicleId = "99999999-9999-4999-8999-999999999999";

  await page.addInitScript(({ storageKey, vehicleId }) => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        step: 6,
        maxStepCompleted: 6,
        pickupDate: "2099-05-10",
        pickupTime: "10:00",
        dropoffDate: "2099-05-12",
        dropoffTime: "10:00",
        pickupLocationId: "L1",
        dropoffLocationId: "L1",
        selectedVehicleId: vehicleId,
        paymentOption: "DEPOSIT",
      }),
    );
  }, { storageKey: WIZARD_DRAFT_STORAGE_KEY, vehicleId: unavailableVehicleId });

  await page.goto("/book", { waitUntil: "networkidle" });
  await expect(page.locator('[data-testid="booking-step-payments"]')).toBeVisible();
  await expect(page.locator('[data-testid="booking-step6-vehicle-warning"]')).toContainText(
    "Selected vehicle is no longer available for these dates. Choose another.",
  );

  const summaryPanel = page.locator("aside").filter({ hasText: "Summary" });
  await expect(summaryPanel).toContainText("Vehicle: Unavailable for selected dates");
  await expect(page.locator('[data-testid="booking-continue-payment"]')).toBeDisabled();

  await page.locator('[data-testid="booking-summary-deselect-vehicle"]').click();
  await expect(page.locator('[data-testid="booking-step-vehicles"]')).toBeVisible();
  await expect(summaryPanel).toContainText("Vehicle: Not selected");
});

test("step tabs unlock by completion and preserve entered Step 3 values", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });

  await expect(page.locator('[data-testid="booking-step-tab-2"]')).toBeDisabled();
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.locator('[data-testid="booking-step-tab-3"]')).toBeDisabled();

  await page.getByRole("button", { name: /^Select$/ }).first().click();
  await page.getByRole("button", { name: "Next Step" }).click();
  await expect(page.locator('[data-testid="booking-step-tab-4"]')).toBeDisabled();

  const quoteWithPromoPromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/public/pricing/quote")) return false;
    const body = response.request().postData() ?? "";
    return body.includes(`\"vehicleId\":\"${VEHICLE_ID}\"`) && body.includes("\"promoCode\":\"SAVE5\"");
  });

  await page.getByLabel("Add plan").check();
  await page.getByPlaceholder("Enter coupon code").fill("SAVE5");
  await page.getByRole("button", { name: "Apply" }).click();
  const quoteWithPromoJson = (await (await quoteWithPromoPromise).json()) as { summary: { total: number } };

  await page.getByRole("button", { name: "Next Step" }).click();
  await page.getByLabel("First Name *").fill("Step");
  await page.getByLabel("Last Name *").fill("Tabs");
  await page.getByLabel("Email Address *").fill("step.tabs@example.com");
  await page.getByLabel("Phone Number *").fill("8765551234");
  await page.getByLabel("DL Number").fill("D1234567");
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

  await page.locator('[data-testid="booking-step-tab-3"]').click();
  await expect(page.getByRole("heading", { name: "Protections & Coverage" })).toBeVisible();
  await expect(page.getByLabel("Add plan")).toBeChecked();
  await expect(page.getByPlaceholder("Enter coupon code")).toHaveValue("SAVE5");

  await page.locator('[data-testid="booking-step-tab-6"]').click();
  await expect(page.locator('[data-testid="booking-step-payments"]')).toBeVisible();
  await expect(page.locator("aside").filter({ hasText: "Pricing (JMD)" })).toContainText(
    formatJmd(quoteWithPromoJson.summary.total),
  );
});

test("step 5 does not show vehicle as not selected while draft selection resolves", async ({ page }) => {
  await page.addInitScript(({ storageKey, vehicleId }) => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        step: 5,
        maxStepCompleted: 5,
        pickupDate: "2099-05-10",
        pickupTime: "10:00",
        dropoffDate: "2099-05-12",
        dropoffTime: "10:00",
        pickupLocationId: "L1",
        dropoffLocationId: "L1",
        selectedVehicleId: vehicleId,
        firstName: "Draft",
        lastName: "User",
        driversLicenseNumber: "D1234567",
      }),
    );
  }, { storageKey: WIZARD_DRAFT_STORAGE_KEY, vehicleId: VEHICLE_ID });

  await page.goto("/book", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Confirm Reservation" })).toBeVisible();
  const confirmPanel = page.locator("section").filter({ hasText: "Confirm Reservation" });
  await expect(confirmPanel).not.toContainText("Vehicle: Not selected");
});

test("step 5 checkbox uses the active theme accent color", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToConfirmStep(page);

  const checkbox = page.getByLabel(
    "By clicking here, I confirm that I accept the privacy policy and terms.",
  );
  const colors = await checkbox.evaluate((element) => {
    const input = element as HTMLInputElement;
    const probe = document.createElement("div");
    probe.style.color = "var(--ccr-accent)";
    document.body.appendChild(probe);
    const resolvedAccent = getComputedStyle(probe).color;
    probe.remove();
    return {
      accentColor: getComputedStyle(input).accentColor,
      resolvedAccent,
    };
  });

  expect(colors.accentColor).toBe(colors.resolvedAccent);
});

test("step 6 custom payment updates the side summary due-now and pickup-balance values", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToPaymentsStep(page);

  const customQuotePromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/public/pricing/quote")) return false;
    const body = response.request().postData() ?? "";
    return body.includes('"paymentOption":"CUSTOM"') && body.includes('"customAmount":"11000"');
  });

  await page.getByRole("button", { name: "Custom Payment" }).click();
  await page.getByLabel("Custom Amount (JMD)").fill("11000");
  const customQuote = (await (await customQuotePromise).json()) as {
    summary: {
      total: number;
      depositRequired: number;
      dueNow: number;
      dueOnPickup: number;
    };
  };

  const pricingPanel = page.locator("aside").filter({ hasText: "Pricing (JMD)" });
  await expect(pricingPanel).toContainText(`Total${formatJmd(customQuote.summary.total)}`);
  await expect(pricingPanel).toContainText(
    `Minimum Deposit to Reserve${formatJmd(customQuote.summary.depositRequired)}`,
  );
  await expect(pricingPanel).toContainText(`Due Now${formatJmd(customQuote.summary.dueNow)}`);
  await expect(pricingPanel).toContainText(
    `Balance Due on Pickup${formatJmd(customQuote.summary.dueOnPickup)}`,
  );
});

test("step 7 checkout route starts Stripe and follows redirect URL", async ({ page }) => {
  let startCallCount = 0;

  await page.route("**/api/payments/start", async (route) => {
    startCallCount += 1;
    const payload = route.request().postDataJSON() as { bookingId?: string; mode?: string };
    expect(payload.bookingId).toBe("booking-123");
    expect(payload.mode).toBe("deposit");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        redirectUrl: "/mock-stripe-checkout",
      }),
    });
  });

  await page.route("**/mock-stripe-checkout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body><h1>Mock Stripe Checkout</h1></body></html>",
    });
  });

  await page.goto("/book/checkout?bookingId=booking-123&paymentOption=DEPOSIT", { waitUntil: "networkidle" });
  await page.waitForURL("**/mock-stripe-checkout");
  expect(startCallCount).toBe(1);
  await expect(page.getByRole("heading", { name: "Mock Stripe Checkout" })).toBeVisible();
});

test("booking draft can be restored then cleared with start over", async ({ page }) => {
  await page.goto("/book", { waitUntil: "networkidle" });
  await advanceToPaymentsStep(page);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('[data-testid="booking-draft-loading"]')).toHaveCount(0);
  await expect(
    page.getByText("Draft restored. For security, please re-sign your signature before continuing."),
  ).toBeVisible();
  const summaryPanel = page.locator("aside").filter({ hasText: "Pricing (JMD)" }).first();
  await expect(summaryPanel).not.toContainText("Vehicle: Not selected");
  const summaryText = (await summaryPanel.textContent()) ?? "";
  expect(summaryText).not.toMatch(/Total\s*\$0\.00/);

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
