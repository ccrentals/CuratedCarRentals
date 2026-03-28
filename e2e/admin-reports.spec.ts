import { expect, test, type TestInfo } from "@playwright/test";

import { authenticateAdmin } from "./support/adminAuth";

const REPORTS_PREVIEW_FLAGS_ENABLED = /^(1|true)$/i.test(
  process.env.REPORTS_PREVIEW_FLAGS_ENABLED ?? "",
);
const BLOCKOUTS_WARNING =
  "Blockouts table not found. Utilization is based on booked days only.";
const MAINTENANCE_WARNING =
  "Maintenance records table not found. Maintenance costs are excluded from this section.";

test.describe("@nightly @tour admin reports operational alignment", () => {
  test("@nightly @tour desktop reports page shows the new filter model, card modes, and export controls", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin reports assertions.");

    await authenticateAdmin(page);
    await page.goto("/admin/reports", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
    await expect(page.getByText("Snapshot date:", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Snapshot Date")).toBeVisible();
    await expect(page.getByLabel("Range From")).toBeVisible();
    await expect(page.getByLabel("Range To")).toBeVisible();
    await expect(
      page.getByText("Operational snapshot and historical analysis are separated per card."),
    ).toBeVisible();
    await expect(page.getByText(/^Live$/)).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Cash Collections by Period" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outstanding Balances" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming Pickups & Returns" })).toBeVisible();

    await expect(page.getByText("Operational snapshot").first()).toBeVisible();
    await expect(page.getByText("Historical analysis").first()).toBeVisible();
    await expect(page.getByText("As of snapshot date").first()).toBeVisible();
    await expect(page.getByText("By payment date").first()).toBeVisible();

    const exportSummaries = page.locator("summary").filter({ hasText: /^Export$/ });
    await expect(exportSummaries).toHaveCount(10);

    await exportSummaries.first().click();
    await expect(page.getByRole("link", { name: "CSV" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "PDF" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Excel" }).first()).toBeVisible();

    const snapshotDateInput = page.getByLabel("Snapshot Date");
    const rangeFromInput = page.getByLabel("Range From");
    const rangeToInput = page.getByLabel("Range To");
    await expect(snapshotDateInput).toHaveClass(/date-icon-edge/);
    await expect(rangeFromInput).toHaveClass(/date-icon-edge/);
    await expect(rangeToInput).toHaveClass(/date-icon-edge/);
  });

  test("@nightly @tour desktop reports preview mode renders degraded warnings deterministically", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin reports assertions.");
    test.skip(
      !REPORTS_PREVIEW_FLAGS_ENABLED,
      "Set REPORTS_PREVIEW_FLAGS_ENABLED=true on the server to verify reports preview warnings.",
    );

    await authenticateAdmin(page);

    await page.goto("/admin/reports?previewMissingBlockouts=1", { waitUntil: "networkidle" });
    await expect(page.getByText("Preview mode: simulating degraded report warnings.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Simulate missing blockouts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText(BLOCKOUTS_WARNING)).toBeVisible();

    await page.goto("/admin/reports?previewMissingMaintenance=1", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Simulate missing maintenance records" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText(MAINTENANCE_WARNING)).toBeVisible();

    await page.goto(
      "/admin/reports?previewMissingBlockouts=1&previewMissingMaintenance=1",
      { waitUntil: "networkidle" },
    );
    await expect(page.getByText("Preview mode: simulating degraded report warnings.")).toBeVisible();
    await expect(page.getByText(BLOCKOUTS_WARNING)).toBeVisible();
    await expect(page.getByText(MAINTENANCE_WARNING)).toBeVisible();

    const exportSummaries = page.locator("summary").filter({ hasText: /^Export$/ });
    await expect(exportSummaries).toHaveCount(10);
  });
});
