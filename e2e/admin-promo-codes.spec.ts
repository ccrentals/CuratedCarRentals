import { expect, test, type TestInfo } from "@playwright/test";
import { authenticateAdmin } from "./support/adminAuth";
import { readE2EFixtures } from "./support/fixtures";

test.describe("@nightly @tour admin promo codes live integration", () => {
  test.describe.configure({ mode: "serial" });

  test("@nightly @tour desktop promo list uses live seeded status, pagination, search, and deactivate flow", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin promo assertions.");

    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.promoCodes?.active?.id || !parsed.promoCodes?.limitReached?.id) {
        throw new Error("Fixtures file is missing seeded promo code references.");
      }
    });

    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto("/admin/promo-codes", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Promo Codes" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Active$/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Scheduled$/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Expired$/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Limit reached$/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Inactive$/ }).first()).toBeVisible();
    await expect(page.getByText("Allowed vehicles 1")).toBeVisible();
    await expect(page.getByText("Blackout dates 2")).toBeVisible();
    await expect(page.getByText("Per customer 1")).toBeVisible();
    await expect(page.getByText(/Showing 1-10 of \d+/)).toBeVisible();

    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Showing 11-\d+ of \d+/)).toBeVisible();
    await expect(page.getByText(fixtures.promoCodes.fillers[fixtures.promoCodes.fillers.length - 1].code)).toBeVisible();

    await page.getByRole("link", { name: "Prev" }).click();
    await expect(page.getByText(/Showing 1-10 of \d+/)).toBeVisible();

    await page.getByLabel("Rows per page").selectOption("30");
    await expect(page.getByText(fixtures.promoCodes.fillers[fixtures.promoCodes.fillers.length - 1].code)).toBeVisible();
    await page.getByLabel("Rows per page").selectOption("10");

    const searchInput = page.getByRole("textbox", { name: "Search code or promo ID" });
    await searchInput.fill(fixtures.promoCodes.scheduled.publicId.toLowerCase());
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(fixtures.promoCodes.scheduled.code)).toBeVisible();
    await expect(page.getByText(fixtures.promoCodes.active.code)).toHaveCount(0);

    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page.getByText(fixtures.promoCodes.active.code)).toBeVisible();

    await page.getByRole("button", { name: "Create promo code" }).click();
    const createPanel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Create promo code" }) })
      .first();
    await expect(page.getByText("Active on creation")).toBeVisible();
    await expect(page.getByText("Excluded vehicles override allowed vehicles")).toBeVisible();
    await createPanel.getByLabel("Apply To").selectOption("DAYS_TOTAL");
    await expect(page.getByText("Min rental-days total (JMD)")).toBeVisible();

    const activeRow = page.locator("tr").filter({ has: page.getByText(fixtures.promoCodes.active.code) }).first();
    await activeRow.scrollIntoViewIfNeeded();
    const activateButton = activeRow.getByRole("button", { name: "Activate" });
    if ((await activateButton.count()) > 0) {
      await activateButton.click();
      await expect(activeRow.getByRole("cell", { name: "Active", exact: true })).toBeVisible();
    }
    await activeRow.getByRole("button", { name: "Deactivate" }).click();
    await expect(activeRow.getByRole("cell", { name: "Inactive", exact: true })).toBeVisible();
  });

  test("@nightly @tour desktop promo detail shows live ledger pagination and coverage metadata", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin promo detail assertions.");

    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.promoCodes?.limitReached?.id) {
        throw new Error("Fixtures file is missing the limit-reached promo fixture.");
      }
    });
    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/promo-codes/${fixtures.promoCodes.limitReached.id}`, {
      waitUntil: "networkidle",
    });

    await expect(page.getByRole("heading", { name: fixtures.promoCodes.limitReached.code })).toBeVisible();
    await expect(page.getByText("Current Counted", { exact: true })).toBeVisible();
    await expect(page.getByText("Discount Redeemed", { exact: true })).toBeVisible();
    await expect(page.getByText("Discount Reversed", { exact: true })).toBeVisible();
    await expect(page.getByText("Redemption Activity")).toBeVisible();
    await expect(page.getByText("Current counted remains authoritative for enforcement.")).toBeVisible();
    await expect(page.getByText(/Historical ledger coverage begins/)).toBeVisible();
    await expect(page.getByText("Showing 1-25 of 30")).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Reversed$/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Redeemed$/ }).first()).toBeVisible();

    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText("Showing 26-30 of 30")).toBeVisible();
    await page.getByRole("link", { name: "Prev" }).click();
    await expect(page.getByText("Showing 1-25 of 30")).toBeVisible();
  });

  test("@nightly @tour desktop promo detail labels reconstructed history and saves live edits", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin promo backfill assertions.");

    const fixtures = readE2EFixtures((parsed) => {
      if (!parsed.promoCodes?.reconstructedHistory?.id) {
        throw new Error("Fixtures file is missing the reconstructed promo fixture.");
      }
    });
    await authenticateAdmin(page, { actorId: fixtures.adminUser?.id ?? null });
    await page.goto(`/admin/promo-codes/${fixtures.promoCodes.reconstructedHistory.id}`, {
      waitUntil: "networkidle",
    });

    await expect(page.getByRole("heading", { name: fixtures.promoCodes.reconstructedHistory.code })).toBeVisible();
    await expect(page.getByText(/Historical ledger coverage begins/)).toBeVisible();
    await expect(page.getByText(/Rows marked Reconstructed/)).toBeVisible();
    await expect(page.getByText("Reconstructed").first()).toBeVisible();
    await expect(
      page.locator("tbody").getByText("Payment", { exact: true }).first(),
    ).toBeVisible();

    await page.getByLabel("Apply To").selectOption("DAYS_TOTAL");
    await expect(page.getByText("Min rental-days total (JMD)")).toBeVisible();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Promo code updated.")).toBeVisible();
  });
});
