import { expect, test } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";
import { readE2EFixtures } from "./support/fixtures";

function formatJmd(amount: number) {
  return Number(amount || 0).toLocaleString("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

test.describe("@smoke admin bookings and payments", () => {
  test("@smoke admin auth bootstrap reaches bookings and filters a seeded booking", async ({
    page,
  }) => {
    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.unpaidDeposit?.id) {
        throw new Error("Fixtures file is missing the unpaid deposit booking state.");
      }
    });

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await expect(page).toHaveURL(/\/admin/);

    await page.goto("/admin/bookings", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();

    await page.getByTestId("bookings-filter-status-pending_payment").click();
    await expect(page).toHaveURL(/status=pending_payment/);

    const searchInput = page.getByTestId("bookings-filter-search");
    await searchInput.fill(fixtures.bookings.unpaidDeposit.publicId);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe(fixtures.bookings.unpaidDeposit.publicId);

    await expect(
      page.locator(
        `[data-testid="booking-row"][data-booking-public-id="${fixtures.bookings.unpaidDeposit.publicId}"]`,
      ),
    ).toBeVisible();
  });

  test("@smoke booking detail records a seeded deposit payment and updates totals", async ({
    page,
  }) => {
    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.unpaidDeposit?.id) {
        throw new Error("Fixtures file is missing the unpaid deposit booking state.");
      }
    });

    const booking = fixtures.bookings.unpaidDeposit;

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/bookings/${booking.id}`, { waitUntil: "networkidle" });

    await expect(page.getByTestId("booking-summary-payment-status")).toHaveText("UNPAID");
    await expect(page.getByTestId("booking-summary-paid-to-date")).toHaveText(formatJmd(0));

    await page.getByTestId("booking-action-deposit").click();

    await expect(page.getByTestId("booking-summary-payment-status")).toHaveText("DEPOSIT PAID");
    await expect(page.getByTestId("booking-summary-paid-to-date")).toHaveText(
      formatJmd(booking.depositCents),
    );
    await expect(page.getByTestId("booking-summary-balance-due")).toHaveText(
      formatJmd(booking.totalCents - booking.depositCents),
    );
    await expect(page.locator('[data-testid="booking-payment-row"]')).toHaveCount(1);
  });

  test("@smoke booking detail adds a second manual payment and reduces the balance", async ({
    page,
  }) => {
    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.partialBalance?.id) {
        throw new Error("Fixtures file is missing the partial balance booking state.");
      }
    });

    const booking = fixtures.bookings.partialBalance;
    const additionalPayment = 7000;

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/bookings/${booking.id}`, { waitUntil: "networkidle" });

    await page.getByTestId("booking-manual-payment-method-select").selectOption("BANK_TRANSFER");
    await expect(page.getByTestId("booking-manual-payment-drawer")).toBeVisible();
    await page.getByTestId("booking-manual-payment-amount").fill(String(additionalPayment));
    await page
      .getByTestId("booking-manual-payment-reference")
      .fill(`SMOKE-${fixtures.runId.toUpperCase()}`);
    await page.getByTestId("booking-manual-payment-note").fill("Smoke manual payment");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("booking-manual-payment-save").click();

    await expect(page.getByTestId("booking-manual-payment-message")).toBeVisible();
    await expect(page.getByTestId("booking-summary-paid-to-date")).toHaveText(
      formatJmd(booking.paidToDate + additionalPayment),
    );
    await expect(page.getByTestId("booking-summary-balance-due")).toHaveText(
      formatJmd(booking.balanceDue - additionalPayment),
    );
  });

  test("@smoke payments page filters by booking and payment type", async ({ page }) => {
    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.fullyPaid?.payments?.deposit?.publicId) {
        throw new Error("Fixtures file is missing the fully paid booking payment refs.");
      }
    });

    const booking = fixtures.bookings.fullyPaid;
    const depositPublicId = booking.payments.deposit?.publicId ?? "";
    const balancePublicId = booking.payments.balance?.publicId ?? "";

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/payments?bookingId=${booking.id}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(
      page.locator(`[data-testid="payments-row"][data-payment-public-id="${depositPublicId}"]:visible`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="payments-row"][data-payment-public-id="${balancePublicId}"]:visible`),
    ).toBeVisible();

    await page.getByTestId("payments-filter-type-balance").click();
    await expect(page).toHaveURL(/paymentType=balance/);
    await expect(
      page.locator(`[data-testid="payments-row"][data-payment-public-id="${balancePublicId}"]:visible`),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="payments-row"][data-payment-public-id="${depositPublicId}"]:visible`),
    ).toHaveCount(0);

    await page.getByTestId("payments-filter-type-deposit").click();
    await expect(page).toHaveURL(/paymentType=deposit/);
    await expect(
      page.locator(`[data-testid="payments-row"][data-payment-public-id="${depositPublicId}"]:visible`),
    ).toBeVisible();
  });
});
