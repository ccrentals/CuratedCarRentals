import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const { Client } = pg;

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ?? process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_USER ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const E2E_ADMIN_USER_ID = process.env.E2E_ADMIN_USER_ID ?? "";
const FIXTURES_PATH = path.join(process.cwd(), ".artifacts", "e2e-fixtures.json");

type FixtureFileShape = {
  adminUser?: { id?: string | null };
};

let cachedActorIdPromise: Promise<string | null> | null = null;

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readActorIdFromFixtures() {
  if (!fs.existsSync(FIXTURES_PATH)) return null;
  try {
    const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
    const parsed = JSON.parse(raw) as FixtureFileShape;
    const actorId = parsed.adminUser?.id?.trim();
    return actorId ? actorId : null;
  } catch {
    return null;
  }
}

async function resolveActorId() {
  if (cachedActorIdPromise) return cachedActorIdPromise;

  cachedActorIdPromise = (async () => {
    const envActorId = E2E_ADMIN_USER_ID.trim();
    if (envActorId) return envActorId;

    const fixtureActorId = readActorIdFromFixtures();
    if (fixtureActorId) return fixtureActorId;

    if (!DATABASE_URL) return null;

    const client = new Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      const result = await client.query<{ id: string }>(
        "select id from users where role in ('ADMIN', 'DEVELOPER') order by created_at asc limit 1",
      );
      return result.rows[0]?.id ?? null;
    } finally {
      await client.end().catch(() => undefined);
    }
  })();

  return cachedActorIdPromise;
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

async function authenticateAdmin(page: Page) {
  if (ADMIN_SESSION_SECRET) {
    const actorId = await resolveActorId();
    if (actorId) {
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
  }

  test.skip(
    !ADMIN_IDENTIFIER || !ADMIN_PASSWORD,
    "Set ADMIN_SESSION_SECRET with a resolvable admin actor id, or provide E2E admin login credentials.",
  );
  await signInWithForm(page);
}

async function updateNotificationRecipientsViaApi(page: Page, value: string) {
  await page.evaluate(async (nextValue) => {
    function readCookieToken() {
      const match = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("ccr_csrf="));
      return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
    }

    let csrfToken = readCookieToken();
    if (!csrfToken) {
      await fetch("/api/security/csrf", { method: "GET", credentials: "include" });
      csrfToken = readCookieToken();
    }
    if (!csrfToken) throw new Error("Missing CSRF token");

    const currentResponse = await fetch("/api/admin/settings", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const currentPayload = (await currentResponse.json().catch(() => ({}))) as {
      settings?: Record<string, unknown>;
      updatedAt?: string | null;
      error?: string;
    };
    if (!currentResponse.ok || !currentPayload.settings) {
      throw new Error(currentPayload.error ?? "Unable to load settings for cleanup.");
    }

    let nextSettings = currentPayload.settings;
    let baseUpdatedAt = currentPayload.updatedAt ?? null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const patchResponse = await fetch("/api/admin/settings", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          settings: {
            ...nextSettings,
            contactNotificationEmails: nextValue,
          },
          baseUpdatedAt,
          csrfToken,
        }),
      });
      const patchPayload = (await patchResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        settings?: Record<string, unknown>;
        updatedAt?: string | null;
      };
      if (patchResponse.ok && patchPayload.ok) {
        return;
      }
      if (patchResponse.status === 409 && patchPayload.settings && attempt === 0) {
        nextSettings = patchPayload.settings;
        baseUpdatedAt = patchPayload.updatedAt ?? null;
        continue;
      }
      throw new Error(patchPayload.message ?? patchPayload.error ?? "Unable to restore settings.");
    }
  }, value);
}

async function restoreNotificationRecipients(page: Page, value: string) {
  await updateNotificationRecipientsViaApi(page, value);
}

test.describe("@tour admin settings save hardening", () => {
  test.describe.configure({ mode: "serial" });

  test("@tour desktop notifications settings warn before losing unsaved changes", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto("/admin/settings?tab=notifications", { waitUntil: "networkidle" });

    const recipientsInput = page.locator('input[placeholder="owner@example.com, ops@example.com"]');
    await expect(recipientsInput).toBeVisible();

    await recipientsInput.fill("unsaved@example.com");
    await expect(page.locator('[data-testid="settings-unsaved-indicator"]')).toBeVisible();

    const dismissDialog = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain("unsaved settings changes");
        await dialog.dismiss();
        resolve();
      });
    });
    await page.getByTestId("settings-tab-general").click();
    await dismissDialog;
    await expect(page).toHaveURL(/tab=notifications/);
    await expect(recipientsInput).toHaveValue("unsaved@example.com");

    const acceptDialog = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain("unsaved settings changes");
        await dialog.accept();
        resolve();
      });
    });
    await page.getByTestId("settings-tab-general").click();
    await acceptDialog;
    await expect(page).toHaveURL(/tab=general/);
  });

  test("@tour desktop notifications settings rehydrate normalized values and show validation errors", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto("/admin/settings?tab=notifications", { waitUntil: "networkidle" });

    const recipientsInput = page.locator('input[placeholder="owner@example.com, ops@example.com"]');
    await expect(recipientsInput).toBeVisible();
    const originalValue = await recipientsInput.inputValue();

    try {
      await recipientsInput.fill("ops@example.com ; sales@example.com");
      await page.locator('[data-testid="settings-save"]').click();
      await expect(page.getByText("Settings saved.")).toBeVisible();
      await expect(recipientsInput).toHaveValue("ops@example.com, sales@example.com");

      await page.reload({ waitUntil: "networkidle" });
      await expect(recipientsInput).toHaveValue("ops@example.com, sales@example.com");

      await recipientsInput.fill("invalid-email");
      await page.locator('[data-testid="settings-save"]').click();
      await expect(page.getByText(/Fix these settings before saving/i)).toBeVisible();
      await expect(page.locator('[data-testid="settings-validation-errors"]')).toContainText(
        "Notifications",
      );
      await expect(page.locator('[data-testid="settings-validation-errors"]')).toContainText(
        "invalid-email",
      );
      await expect(page.getByText("Settings saved.")).toHaveCount(0);
    } finally {
      await restoreNotificationRecipients(page, originalValue);
      await page.reload({ waitUntil: "networkidle" });
      await expect(recipientsInput).toHaveValue(originalValue);
    }
  });

  test("@tour desktop notifications settings show conflict guidance and reload latest server values", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto("/admin/settings?tab=notifications", { waitUntil: "networkidle" });

    const recipientsInput = page.locator('input[placeholder="owner@example.com, ops@example.com"]');
    await expect(recipientsInput).toBeVisible();
    const originalValue = await recipientsInput.inputValue();
    const conflictValue = "latest-server@example.com";

    try {
      await recipientsInput.fill("local-change@example.com");
      await updateNotificationRecipientsViaApi(page, conflictValue);
      await page.locator('[data-testid="settings-save"]').click();

      await expect(page.locator('[data-testid="settings-conflict-message"]')).toContainText(
        "latest server values were loaded",
      );
      await expect(page.getByText("Settings saved.")).toHaveCount(0);
      await expect(recipientsInput).toHaveValue(conflictValue);
      await expect(page.locator('[data-testid="settings-unsaved-indicator"]')).toHaveCount(0);
    } finally {
      await restoreNotificationRecipients(page, originalValue);
      await page.reload({ waitUntil: "networkidle" });
      await expect(recipientsInput).toHaveValue(originalValue);
    }
  });

  test("@tour desktop settings only load maintenance service types when the maintenance tab opens", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    const serviceTypeRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/admin/maintenance/service-types")) {
        serviceTypeRequests.push(request.url());
      }
    });

    await page.goto("/admin/settings?tab=notifications", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    expect(serviceTypeRequests.length).toBe(0);

    const serviceTypeRequest = page.waitForRequest((request) =>
      request.url().includes("/api/admin/maintenance/service-types"),
    );
    await page.getByTestId("settings-tab-maintenance").click();
    await serviceTypeRequest;
    expect(serviceTypeRequests.length).toBeGreaterThan(0);
  });
});
