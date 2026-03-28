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

test.describe("@nightly admin bookings and payments regression", () => {
  test("@nightly desktop partial-balance booking can be marked fully paid", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin booking assertions.");

    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.partialBalance?.id) {
        throw new Error("Fixtures file is missing the partial balance booking state.");
      }
    });

    const booking = fixtures.bookings.partialBalance;

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/bookings/${booking.id}`, { waitUntil: "networkidle" });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("booking-action-full").click();

    await expect(page.getByTestId("booking-summary-payment-status")).toHaveText("PAID IN FULL");
    await expect(page.getByTestId("booking-summary-paid-to-date")).toHaveText(
      formatJmd(booking.totalCents),
    );
    await expect(page.getByTestId("booking-summary-balance-due")).toHaveText(formatJmd(0));
  });

  test("@nightly desktop seeded refund-required booking surfaces a stable warning state", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin booking assertions.");

    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.refundRequired?.id) {
        throw new Error("Fixtures file is missing the refund-required booking state.");
      }
    });

    const booking = fixtures.bookings.refundRequired;

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/bookings/${booking.id}`, { waitUntil: "networkidle" });

    await expect(page.getByTestId("booking-status-badge")).toContainText("CANCELLED");
    await expect(page.getByTestId("booking-summary-refund-required")).toBeVisible();
    await expect(page.getByTestId("booking-refund-required-toast")).toBeVisible();
  });

  test("@nightly desktop WIPAY refund bookkeeping works after cancellation", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin booking assertions.");

    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.bookings?.refundableWipay?.payments?.wipay?.publicId) {
        throw new Error("Fixtures file is missing the refundable WIPAY booking state.");
      }
    });

    const booking = fixtures.bookings.refundableWipay;
    const wipayPublicId = booking.payments.wipay?.publicId ?? "";

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/bookings/${booking.id}`, { waitUntil: "networkidle" });

    await expect(page.getByTestId("booking-summary-refund-required")).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("booking-action-cancel").click();

    await expect(page.getByTestId("booking-status-badge")).toContainText("CANCELLED");
    await expect(page.getByTestId("booking-summary-refund-required")).toBeVisible();

    const wipayRow = page.locator(
      `[data-testid="booking-payment-row"][data-payment-public-id="${wipayPublicId}"]`,
    );
    await expect(wipayRow).toBeVisible();
    await wipayRow.getByTestId("payment-row-action-refund").click();
    await expect(page.getByTestId("payment-row-action-dialog")).toBeVisible();
    await page.getByTestId("payment-row-action-reason").fill("Nightly WIPAY refund coverage");
    await page.getByTestId("payment-row-action-confirm").click();

    await expect(page.getByTestId("booking-summary-paid-to-date")).toHaveText(formatJmd(0));
    await expect(page.getByTestId("booking-summary-refund-required")).toHaveCount(0);
    await expect(page.getByTestId("booking-payment-status").filter({ hasText: /Refunded/i })).toHaveCount(1);
  });

  test("@nightly desktop payments page supports sorting, pagination, and export", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin payments assertions.");

    const fixtures = readE2EFixtures();

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto("/admin/payments", { waitUntil: "networkidle" });

    const visibleRows = page.locator('[data-testid="payments-row"]:visible');

    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await page.getByLabel("Rows per page").selectOption("10");
    await expect(page).toHaveURL(/rows=10/);
    await expect.poll(() => visibleRows.count()).toBe(10);

    await page.getByRole("button", { name: "Load more" }).click();
    await expect.poll(() => visibleRows.count()).toBeGreaterThan(10);

    await page.getByRole("link", { name: "Sort by Amount" }).click();
    await expect(page).toHaveURL(/sortBy=amount/);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("payments-export-csv").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/payments/i);
  });
});
