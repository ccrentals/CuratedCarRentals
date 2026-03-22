import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const FIXTURES_PATH = path.join(process.cwd(), ".artifacts", "e2e-fixtures.json");

type PromoFixtureRef = {
  id: string;
  publicId: string;
  code: string;
};

type E2EFixtures = {
  runId: string;
  adminUser?: {
    id?: string | null;
  };
  promoCodes: {
    active: PromoFixtureRef;
    scheduled: PromoFixtureRef;
    expired: PromoFixtureRef;
    limitReached: PromoFixtureRef;
    inactive: PromoFixtureRef;
    vehicleRestricted: PromoFixtureRef;
    blackoutRestricted: PromoFixtureRef;
    perCustomerLimited: PromoFixtureRef;
    reconstructedHistory: PromoFixtureRef;
    fillers: PromoFixtureRef[];
  };
};

function readFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(`Fixtures file not found: ${FIXTURES_PATH}. Run npm run e2e:seed first.`);
  }

  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  const parsed = JSON.parse(raw) as E2EFixtures;

  if (!parsed?.promoCodes?.active?.id || !parsed?.promoCodes?.limitReached?.id) {
    throw new Error("Fixtures file is missing seeded promo code references.");
  }

  return parsed;
}

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function signInWithForm(page: Page) {
  await page.goto("/admin/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email or username").fill(ADMIN_IDENTIFIER);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(
    (url) => {
      const route = url.pathname;
      return route.startsWith("/admin") && route !== "/admin/login";
    },
    { timeout: 20_000 },
  );
}

async function authenticateAdmin(page: Page, fixtures: E2EFixtures) {
  const actorId = fixtures.adminUser?.id ?? null;

  if (ADMIN_SESSION_SECRET && actorId) {
    const token = createSessionToken(actorId, "ADMIN");
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
    const route = new URL(page.url()).pathname;
    if (route.startsWith("/admin") && route !== "/admin/login") {
      return;
    }
  }

  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    "Set ADMIN_SESSION_SECRET or E2E admin login credentials.",
  );
  await signInWithForm(page);
}

test.describe("@tour admin promo codes live integration", () => {
  test.describe.configure({ mode: "serial" });

  test("@tour desktop promo list uses live seeded status, pagination, search, and deactivate flow", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin promo assertions.");

    const fixtures = readFixtures();

    await authenticateAdmin(page, fixtures);
    await page.goto("/admin/promo-codes", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Promo Codes" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Active$/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Scheduled$/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Expired$/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /^Limit reached$/ })).toBeVisible();
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

  test("@tour desktop promo detail shows live ledger pagination and coverage metadata", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin promo detail assertions.");

    const fixtures = readFixtures();
    await authenticateAdmin(page, fixtures);
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

  test("@tour desktop promo detail labels reconstructed history and saves live edits", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only admin promo backfill assertions.");

    const fixtures = readFixtures();
    await authenticateAdmin(page, fixtures);
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
