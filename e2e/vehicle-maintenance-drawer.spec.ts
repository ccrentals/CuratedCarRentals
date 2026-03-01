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

type E2EFixtures = {
  adminUser?: { id?: string | null };
  vehicle: { id: string };
};

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

function readFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(`Fixtures file not found: ${FIXTURES_PATH}. Run npm run e2e:seed first.`);
  }
  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  return JSON.parse(raw) as E2EFixtures;
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

test.describe("@tour vehicle maintenance drawer", () => {
  for (const viewport of VIEWPORTS) {
    test(`@tour add maintenance drawer opens/closes (${viewport.name})`, async ({ page }) => {
      const fixtures = readFixtures();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await authenticateAdmin(page, fixtures);

      await page.goto(`/admin/vehicles/${fixtures.vehicle.id}?tab=maintenance`, { waitUntil: "networkidle" });
      await expect(page.locator('[data-testid="vehicle-maintenance-panel"]')).toBeVisible();

      await page.locator('[data-testid="maintenance-add"]').click();
      const drawer = page.locator('[data-testid="maintenance-form-drawer"]');
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute("data-vaul-drawer-direction", "right");

      await page.getByLabel("Close add maintenance drawer").click();
      await expect(drawer).toBeHidden();

      await page.locator('[data-testid="maintenance-add"]').click();
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();

      await page.locator('[data-testid="maintenance-add"]').click();
      await expect(drawer).toBeVisible();
      const currentBox = await drawer.boundingBox();
      if (currentBox && currentBox.x > 32) {
        await page.mouse.click(8, Math.max(8, Math.round(currentBox.y + 12)));
        await expect(drawer).toBeHidden();
      }
    });
  }
});
