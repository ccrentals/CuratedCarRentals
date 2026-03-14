import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";
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
const VEHICLE_ID = "993c77cd-6e86-4354-990f-93e6cd402c48";

type FixtureFileShape = {
  adminUser?: { id?: string | null };
};

type BrowserApiResult<T> = {
  status: number;
  body: T;
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

async function browserPost<T>(
  page: Page,
  url: string,
  payload: Record<string, unknown>,
): Promise<BrowserApiResult<T>> {
  return page.evaluate(
    async ({ endpoint, body }) => {
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

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          ...body,
          csrfToken,
        }),
      });

      return {
        status: response.status,
        body: (await response.json().catch(() => ({}))) as T,
      };
    },
    { endpoint: url, body: payload },
  );
}

async function browserDelete(page: Page, url: string) {
  return page.evaluate(async (endpoint) => {
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

    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ csrfToken }),
    });

    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string },
    };
  }, url);
}

test.describe("@tour vehicle files and checklist integration", () => {
  test("@tour desktop checklist attachment state follows linked file lifecycle", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(90_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
    await expect(page.getByText("Template coverage")).toBeVisible();
    await expect(page.getByText(/Active templates:/)).toBeVisible();

    const stamp = Date.now();
    const checklistLabel = `Codex Checklist A ${stamp}`;
    const secondChecklistLabel = `Codex Checklist B ${stamp}`;
    const fileLabel = `Codex File ${stamp}`;
    let checklistItemId: string | null = null;
    let secondChecklistItemId: string | null = null;

    try {
      const checklistCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/checklist`,
        {
          label: checklistLabel,
          folder: "Paperwork",
          required: true,
          allowNotRequired: false,
        },
      );
      expect(checklistCreate.status).toBe(200);
      expect(checklistCreate.body.ok).toBe(true);
      checklistItemId = checklistCreate.body.item?.id ?? null;
      expect(checklistItemId).toBeTruthy();

      const secondChecklistCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/checklist`,
        {
          label: secondChecklistLabel,
          folder: "Paperwork",
          required: false,
          allowNotRequired: true,
        },
      );
      expect(secondChecklistCreate.status).toBe(200);
      expect(secondChecklistCreate.body.ok).toBe(true);
      secondChecklistItemId = secondChecklistCreate.body.item?.id ?? null;
      expect(secondChecklistItemId).toBeTruthy();

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=files`, { waitUntil: "networkidle" });
      const checklistLinkSelect = page.locator('[data-testid="vehicle-files-checklist-link"]');
      await expect(checklistLinkSelect).toBeVisible();
      await expect(checklistLinkSelect.locator(`option[value="${checklistItemId}"]`)).toContainText(
        checklistLabel,
      );
      await expect(
        checklistLinkSelect.locator(`option[value="${secondChecklistItemId}"]`),
      ).toContainText(secondChecklistLabel);

      const fileCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null; checklistItemLabel?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/documents`, {
        folder: "Paperwork",
        documentType: "Other",
        label: fileLabel,
        title: `${fileLabel}.pdf`,
        storageProvider: "UPLOADCARE_FILE_ID",
        storageKey: "7f6b5a4a-84f9-4e57-8be4-7b4b2cbf76ad",
        checklistItemId,
      });
      expect(fileCreate.status).toBe(200);
      expect(fileCreate.body.ok).toBe(true);
      expect(fileCreate.body.item?.id).toBeTruthy();
      expect(fileCreate.body.item?.checklistItemLabel).toBe(checklistLabel);

      const documentId = fileCreate.body.item?.id ?? "";
      await page.reload({ waitUntil: "networkidle" });

      const fileRow = page.locator("tr", { hasText: fileLabel }).first();
      await expect(fileRow).toBeVisible();
      await expect(fileRow).toContainText(checklistLabel);

      await fileRow.locator('[data-testid="vehicle-file-link-select"]').selectOption(
        secondChecklistItemId ?? "",
      );
      await fileRow.getByRole("button", { name: "Save link" }).click();
      await expect(page.getByText("File link updated.")).toBeVisible();
      await expect(fileRow).toContainText(secondChecklistLabel);

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const checklistCard = page.locator("article", { hasText: checklistLabel }).first();
      await expect(checklistCard).toBeVisible();
      await expect(checklistCard).not.toContainText(`Attached file: ${fileLabel}`);
      const secondChecklistCard = page.locator("article", { hasText: secondChecklistLabel }).first();
      await expect(secondChecklistCard).toBeVisible();
      await expect(secondChecklistCard).toContainText(`Attached file: ${fileLabel}`);
      await expect(
        secondChecklistCard.getByTestId("vehicle-checklist-download-file"),
      ).toHaveAttribute(
        "href",
        `/api/admin/vehicles/${VEHICLE_ID}/documents/${documentId}/download`,
      );
      await expect(secondChecklistCard.getByTestId("vehicle-checklist-manage-file")).toHaveAttribute(
        "href",
        `/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork`,
      );

      await secondChecklistCard.getByTestId("vehicle-checklist-manage-file").click();
      await page.waitForURL(`**/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork`);
      await expect(page.getByTestId("vehicle-files-folder-select")).toHaveValue("Paperwork");

      const archiveRow = page.locator("tr", { hasText: fileLabel }).first();
      await archiveRow.locator('[data-testid="vehicle-file-link-select"]').selectOption("");
      await archiveRow.getByRole("button", { name: "Save link" }).click();
      await expect(page.getByText("File unlinked from checklist.")).toBeVisible();

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const secondChecklistCardAfterUnlink = page.locator("article", { hasText: secondChecklistLabel }).first();
      await expect(secondChecklistCardAfterUnlink).toBeVisible();
      await expect(secondChecklistCardAfterUnlink).not.toContainText(`Attached file: ${fileLabel}`);

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=files`, { waitUntil: "networkidle" });
      const archiveRowAfterUnlink = page.locator("tr", { hasText: fileLabel }).first();
      page.once("dialog", (dialog) => void dialog.accept());
      await archiveRowAfterUnlink.getByRole("button", { name: "Archive" }).click();
      await expect(page.getByText("File archived.")).toBeVisible();

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const checklistCardAfterArchive = page.locator("article", { hasText: checklistLabel }).first();
      await expect(checklistCardAfterArchive).toBeVisible();
      await expect(checklistCardAfterArchive).not.toContainText(`Attached file: ${fileLabel}`);

      const checklistJson = await page.locator("body").textContent();
      expect(checklistJson ?? "").not.toContain(`Attached file: ${fileLabel}`);
      expect(documentId).not.toBe("");
    } finally {
      if (checklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${checklistItemId}`);
      }
      if (secondChecklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${secondChecklistItemId}`);
      }
    }
  });
});
