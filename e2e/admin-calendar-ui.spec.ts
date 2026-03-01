import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const FIXTURES_PATH = path.join(process.cwd(), ".artifacts", "e2e-fixtures.json");

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

type E2EFixtures = {
  adminUser?: { id?: string | null };
  vehicle: { id: string };
};

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(`Fixtures file not found: ${FIXTURES_PATH}. Run npm run e2e:seed first.`);
  }
  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  return JSON.parse(raw) as E2EFixtures;
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

    if (!ADMIN_IDENTIFIER || !ADMIN_PASSWORD) {
      test.skip(
        true,
        "Admin cookie auth was rejected and no E2E admin login credentials were provided.",
      );
    }
  }

  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    "Set ADMIN_SESSION_SECRET or E2E admin login credentials.",
  );
  await signInWithForm(page);
}

function ymd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test.describe("@tour admin calendar UI", () => {
  for (const viewport of VIEWPORTS) {
    test(`@tour booking filters single-date picker (${viewport.name})`, async ({ page }) => {
      const fixtures = readFixtures();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await authenticateAdmin(page, fixtures);

      await page.goto("/admin/bookings", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/\/admin\/bookings/);

      const fromValue = ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 14));
      const toValue = ymd(new Date());

      const dateFromInput = page.locator('[data-testid="bookings-filter-date-from"]');
      const dateToInput = page.locator('[data-testid="bookings-filter-date-to"]');

      await expect(dateFromInput).toBeVisible();
      await expect(dateToInput).toBeVisible();

      await dateFromInput.fill(fromValue);
      await expect.poll(() => new URL(page.url()).searchParams.get("dateFrom")).toBe(fromValue);
      await dateToInput.fill(toValue);
      await expect.poll(() => new URL(page.url()).searchParams.get("dateTo")).toBe(toValue);
    });

    test(`@tour vehicle performance date-range picker (${viewport.name})`, async ({ page }) => {
      const fixtures = readFixtures();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await authenticateAdmin(page, fixtures);

      await page.goto(`/admin/vehicles/${fixtures.vehicle.id}?tab=performance`, { waitUntil: "networkidle" });

      const panel = page.locator('[data-testid="vehicle-performance-panel"]');
      await expect(panel).toBeVisible();

      await page.getByRole("button", { name: "Custom" }).first().click();
      const startInput = panel.locator('[data-testid="performance-custom-start"]');
      const endInput = panel.locator('[data-testid="performance-custom-end"]');
      await expect(startInput).toBeVisible();
      await expect(endInput).toBeVisible();

      const rangeStart = ymd(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30));
      const rangeEnd = ymd(new Date());
      await startInput.fill(rangeStart);
      await endInput.fill(rangeEnd);
      await panel.getByRole("button", { name: "Apply" }).first().click();

      await expect(panel).not.toContainText("Custom range requires both start and end dates.");
      await expect(panel.getByText("Range pending")).toHaveCount(0);
    });
  }
});
