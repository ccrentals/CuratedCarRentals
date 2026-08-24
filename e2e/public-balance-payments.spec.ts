import { expect, test } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";
import { readE2EFixtures } from "./support/fixtures";

test.describe("@nightly customer balance payments", () => {
  test("offers a J$1,000 partial payment and previews the remaining balance", async ({ page }) => {
    const fixtures = readE2EFixtures();
    const booking = fixtures.bookings.partialBalance;
    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });

    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/payments/start", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, redirectUrl: "/payment/success" }),
      });
    });

    await page.goto(`/bookings/${booking.id}/balance`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Make a Payment" })).toBeVisible();
    await expect(page.getByText("Paid to date:")).toBeVisible();
    await expect(page.getByText("Balance due:")).toBeVisible();

    await page.getByLabel("Partial payment amount (JMD)").fill("1000");
    await expect(page.getByText(/Remaining balance after payment:/)).toBeVisible();
    await page.getByRole("button", { name: "Make Partial Payment" }).click();
    await expect.poll(() => requestBody).toEqual({
      bookingId: booking.id,
      mode: "partial",
      amountJmd: 1000,
    });
  });

  test("validates partial amounts in the browser and keeps a separate full-balance action", async ({ page }) => {
    const fixtures = readE2EFixtures();
    const booking = fixtures.bookings.partialBalance;
    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/bookings/${booking.id}/balance`, { waitUntil: "networkidle" });

    await page.getByLabel("Partial payment amount (JMD)").fill("999");
    await page.getByRole("button", { name: "Make Partial Payment" }).click();
    await expect(page.getByRole("alert")).toContainText("at least");

    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/payments/start", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, redirectUrl: "/payment/success" }),
      });
    });
    await page.getByRole("button", { name: /Pay Full Balance/ }).click();
    await expect.poll(() => requestBody).toEqual({ bookingId: booking.id, mode: "balance" });
  });

  test("shows paid in full without payment actions when no balance remains", async ({ page }) => {
    const fixtures = readE2EFixtures();
    const booking = fixtures.bookings.fullyPaid;
    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/bookings/${booking.id}/balance`, { waitUntil: "networkidle" });

    await expect(page.getByText("Paid in full", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make Partial Payment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Pay Full Balance/ })).toHaveCount(0);
  });
});
