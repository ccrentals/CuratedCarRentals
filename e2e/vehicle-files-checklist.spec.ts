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

async function browserGet<T>(page: Page, url: string): Promise<BrowserApiResult<T>> {
  return page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as T,
    };
  }, url);
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

async function browserPatch<T>(
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
        method: "PATCH",
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

test.describe("@tour vehicle files and checklist integration", () => {
  test("@tour desktop checklist attachment state follows linked file lifecycle", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
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
    const spareFileLabel = `Codex Spare ${stamp}`;
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
      await expect(page.getByTestId("vehicle-files-message")).toContainText("File link updated.");
      await expect(page.getByTestId("vehicle-files-message")).toHaveClass(
        /text-\[var\(--ccr-accent-strong\)\]/,
      );
      await expect(fileRow).toContainText(secondChecklistLabel);

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const checklistCard = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
      await expect(checklistCard).toBeVisible();
      await expect(checklistCard).not.toContainText(`Attached file: ${fileLabel}`);
      await expect(checklistCard).toContainText("linked elsewhere hidden until enabled");
      await checklistCard
        .getByTestId(`vehicle-checklist-attachment-search-${checklistItemId}`)
        .fill(fileLabel);
      await expect(
        checklistCard
          .getByTestId(`vehicle-checklist-attachment-select-${checklistItemId}`)
          .locator(`option[value="${documentId}"]`),
      ).toHaveCount(0);
      await checklistCard
        .getByTestId(`vehicle-checklist-attachment-include-linked-${checklistItemId}`)
        .check();
      await expect(
        checklistCard
          .getByTestId(`vehicle-checklist-attachment-select-${checklistItemId}`)
          .locator(`option[value="${documentId}"]`),
      ).toHaveCount(1);
      const secondChecklistCard = page.getByTestId(`vehicle-checklist-item-${secondChecklistItemId}`);
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
        `/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&documentId=${documentId}`,
      );
      await secondChecklistCard.getByTestId("vehicle-checklist-preview-file").click();
      await expect(page.getByTestId("vehicle-checklist-preview-modal")).toBeVisible();
      await expect(page.getByTestId("vehicle-checklist-preview-meta")).toContainText(
        secondChecklistLabel,
      );
      await expect(page.getByTestId("vehicle-checklist-preview-meta")).toContainText("Other");
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=checklist$`),
      );
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("vehicle-checklist-preview-modal")).not.toBeVisible();

      await secondChecklistCard.getByTestId("vehicle-checklist-manage-file").click();
      await page.waitForURL(
        `**/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&documentId=${documentId}`,
      );
      await expect(page.getByTestId("vehicle-files-folder-select")).toHaveValue("Paperwork");
      await expect(page.getByTestId("vehicle-file-preview-modal")).toBeVisible();
      await expect(page.getByTestId("vehicle-file-preview-meta")).toContainText(secondChecklistLabel);
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("vehicle-file-preview-modal")).not.toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=files&folder=Paperwork$`),
      );
      await expect(page.getByTestId("vehicle-file-focus-banner")).toBeVisible();
      await expect(page.getByTestId(`vehicle-file-row-${documentId}`)).toHaveAttribute(
        "data-highlighted",
        "true",
      );
      await page.getByTestId("vehicle-file-clear-highlight").click();
      await expect(page.getByTestId("vehicle-file-focus-banner")).not.toBeVisible();
      await expect(page.getByTestId(`vehicle-file-row-${documentId}`)).toHaveAttribute(
        "data-highlighted",
        "false",
      );
      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const secondChecklistCardAgain = page.getByTestId(
        `vehicle-checklist-item-${secondChecklistItemId}`,
      );
      await expect(secondChecklistCardAgain).toBeVisible();
      await secondChecklistCardAgain.getByTestId("vehicle-checklist-manage-file").click();
      await page.waitForURL(
        `**/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&documentId=${documentId}`,
      );
      await expect(page.getByTestId("vehicle-file-preview-modal")).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("vehicle-file-preview-modal")).not.toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=files&folder=Paperwork$`),
      );
      await expect(page.getByTestId("vehicle-file-focus-banner")).toBeVisible();
      await page.getByTestId("vehicle-file-view-checklist-item").click();
      await expect(page.getByTestId("vehicle-checklist-focus-banner")).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=checklist$`),
      );
      await expect(
        page.getByTestId(`vehicle-checklist-item-${secondChecklistItemId}`),
      ).toHaveAttribute("data-highlighted", "true");
      await page.getByTestId("vehicle-checklist-preview-highlighted-file").click();
      await expect(page.getByTestId("vehicle-checklist-preview-modal")).toBeVisible();
      await expect(page.getByTestId("vehicle-checklist-preview-meta")).toContainText(
        secondChecklistLabel,
      );
      await expect(page.getByTestId("vehicle-checklist-preview-meta")).toContainText("Other");
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=checklist$`),
      );
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("vehicle-checklist-preview-modal")).not.toBeVisible();
      await page.getByTestId("vehicle-checklist-view-file").click();
      await page.waitForURL(
        `**/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&documentId=${documentId}`,
      );
      await expect(page.getByTestId("vehicle-file-preview-modal")).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("vehicle-file-preview-modal")).not.toBeVisible();
      await expect(page.getByTestId("vehicle-file-focus-banner")).toBeVisible();

      const archiveRow = page.locator("tr", { hasText: fileLabel }).first();
      await archiveRow.locator('[data-testid="vehicle-file-link-select"]').selectOption("");
      await archiveRow.getByRole("button", { name: "Save link" }).click();
      await expect(page.getByTestId("vehicle-files-message")).toContainText(
        "File unlinked from checklist.",
      );
      await expect(page.getByTestId("vehicle-files-message")).toHaveClass(
        /text-\[var\(--ccr-accent-strong\)\]/,
      );

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const secondChecklistCardAfterUnlink = page.getByTestId(
        `vehicle-checklist-item-${secondChecklistItemId}`,
      );
      await expect(secondChecklistCardAfterUnlink).toBeVisible();
      await expect(secondChecklistCardAfterUnlink).not.toContainText(`Attached file: ${fileLabel}`);

      const spareFileCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/documents`, {
        folder: "Paperwork",
        documentType: "Other",
        label: spareFileLabel,
        title: `${spareFileLabel}.pdf`,
        storageProvider: "UPLOADCARE_FILE_ID",
        storageKey: "e7b9c1d1-7fd9-4f93-a6d9-d77e4cd1a84b",
      });
      expect(spareFileCreate.status).toBe(200);
      expect(spareFileCreate.body.ok).toBe(true);
      const spareDocumentId = spareFileCreate.body.item?.id ?? "";
      expect(spareDocumentId).not.toBe("");

      await page.reload({ waitUntil: "networkidle" });
      await page
        .getByTestId(`vehicle-checklist-attachment-select-${secondChecklistItemId}`)
        .selectOption(spareDocumentId);
      await page
        .getByTestId(`vehicle-checklist-attachment-save-${secondChecklistItemId}`)
        .click();
      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "Checklist attachment added.",
      );
      await expect(page.getByTestId("vehicle-checklist-message")).toHaveClass(
        /text-\[var\(--ccr-accent-strong\)\]/,
      );

      const secondChecklistCardAfterAttach = page.getByTestId(
        `vehicle-checklist-item-${secondChecklistItemId}`,
      );
      await expect(secondChecklistCardAfterAttach).toContainText(`Attached file: ${spareFileLabel}`);
      await secondChecklistCardAfterAttach.getByTestId("vehicle-checklist-preview-file").click();
      await expect(page.getByTestId("vehicle-checklist-preview-modal")).toBeVisible();
      await expect(page.getByTestId("vehicle-checklist-preview-meta")).toContainText(
        secondChecklistLabel,
      );
      await expect(page.getByTestId("vehicle-checklist-preview-meta")).toContainText("Other");
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("vehicle-checklist-preview-modal")).not.toBeVisible();

      await page
        .getByTestId(`vehicle-checklist-attachment-clear-${secondChecklistItemId}`)
        .click();
      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "Checklist attachment cleared.",
      );
      const secondChecklistCardAfterChecklistClear = page.getByTestId(
        `vehicle-checklist-item-${secondChecklistItemId}`,
      );
      await expect(secondChecklistCardAfterChecklistClear).not.toContainText(
        `Attached file: ${spareFileLabel}`,
      );

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=files`, { waitUntil: "networkidle" });
      const archiveRowAfterUnlink = page.locator("tr", { hasText: fileLabel }).first();
      page.once("dialog", (dialog) => void dialog.accept());
      await archiveRowAfterUnlink.getByRole("button", { name: "Archive" }).click();
      await expect(page.getByTestId("vehicle-files-message")).toContainText("File archived.");

      const archiveSpareRow = page.locator("tr", { hasText: spareFileLabel }).first();
      page.once("dialog", (dialog) => void dialog.accept());
      await archiveSpareRow.getByRole("button", { name: "Archive" }).click();
      await expect(page.getByTestId("vehicle-files-message")).toContainText("File archived.");

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const checklistCardAfterArchive = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
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

  test("@tour desktop checklist can pretarget the files uploader", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    const stamp = Date.now();
    const checklistLabel = `Codex Upload Target A ${stamp}`;
    const attachedChecklistLabel = `Codex Upload Target B ${stamp}`;
    const fileLabel = `Codex Upload Target File ${stamp}`;
    let checklistItemId: string | null = null;
    let attachedChecklistItemId: string | null = null;
    let documentId: string | null = null;

    try {
      const checklistCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/checklist`,
        {
          label: checklistLabel,
          folder: "Paperwork",
          required: false,
          allowNotRequired: true,
        },
      );
      expect(checklistCreate.status).toBe(200);
      checklistItemId = checklistCreate.body.item?.id ?? null;
      expect(checklistItemId).toBeTruthy();

      const attachedChecklistCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: attachedChecklistLabel,
        folder: "Paperwork",
        required: true,
        allowNotRequired: false,
      });
      expect(attachedChecklistCreate.status).toBe(200);
      attachedChecklistItemId = attachedChecklistCreate.body.item?.id ?? null;
      expect(attachedChecklistItemId).toBeTruthy();

      const fileCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/documents`,
        {
          folder: "Paperwork",
          documentType: "Other",
          label: fileLabel,
          title: `${fileLabel}.pdf`,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: "f5e9e3a1-4d55-4c74-b6f8-2c8ee4903cb5",
          checklistItemId: attachedChecklistItemId,
        },
      );
      expect(fileCreate.status).toBe(200);
      documentId = fileCreate.body.item?.id ?? null;
      expect(documentId).toBeTruthy();

      await page.reload({ waitUntil: "networkidle" });

      const checklistCard = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
      await expect(checklistCard).toBeVisible();
      await expect(checklistCard.getByTestId("vehicle-checklist-add-file")).toHaveAttribute(
        "href",
        `/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&attachChecklistItemId=${checklistItemId}`,
      );
      await checklistCard.getByTestId("vehicle-checklist-add-file").click();
      await page.waitForURL(
        `**/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&attachChecklistItemId=${checklistItemId}`,
      );
      await expect(page.getByTestId("vehicle-files-checklist-link")).toHaveValue(checklistItemId ?? "");
      await expect(page.getByTestId("vehicle-files-upload-target-banner")).toContainText(
        checklistLabel,
      );
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=files&folder=Paperwork$`),
      );
      await page.getByTestId("vehicle-files-clear-upload-target").click();
      await expect(page.getByTestId("vehicle-files-upload-target-banner")).not.toBeVisible();
      await expect(page.getByTestId("vehicle-files-checklist-link")).toHaveValue("");

      await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });
      const attachedChecklistCard = page.getByTestId(
        `vehicle-checklist-item-${attachedChecklistItemId}`,
      );
      await expect(attachedChecklistCard).toBeVisible();
      await expect(attachedChecklistCard.getByTestId("vehicle-checklist-replace-file")).toHaveAttribute(
        "href",
        `/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&attachChecklistItemId=${attachedChecklistItemId}`,
      );
      await attachedChecklistCard.getByTestId("vehicle-checklist-replace-file").click();
      await page.waitForURL(
        `**/admin/vehicles/${VEHICLE_ID}?tab=files&folder=Paperwork&attachChecklistItemId=${attachedChecklistItemId}`,
      );
      await expect(page.getByTestId("vehicle-files-checklist-link")).toHaveValue(
        attachedChecklistItemId ?? "",
      );
      await expect(page.getByTestId("vehicle-files-upload-target-banner")).toContainText(
        attachedChecklistLabel,
      );
      await expect(page.getByTestId("vehicle-files-upload-target-banner")).toContainText(
        "replace the current attachment",
      );
      await expect(page).toHaveURL(
        new RegExp(`/admin/vehicles/${VEHICLE_ID}\\?tab=files&folder=Paperwork$`),
      );
    } finally {
      if (documentId) {
        await browserPatch(page, `/api/admin/vehicles/${VEHICLE_ID}/documents/${documentId}`, {
          archived: true,
        }).catch(() => undefined);
      }
      if (checklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${checklistItemId}`).catch(
          () => undefined,
        );
      }
      if (attachedChecklistItemId) {
        await browserDelete(
          page,
          `/api/admin/vehicles/${VEHICLE_ID}/checklist/${attachedChecklistItemId}`,
        ).catch(() => undefined);
      }
    }
  });

  test("@tour desktop checklist items can be edited in place", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    const stamp = Date.now();
    const originalLabel = `Codex Editable ${stamp}`;
    const updatedLabel = `Codex Edited ${stamp}`;
    let checklistItemId: string | null = null;

    try {
      const checklistCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: originalLabel,
        folder: "Paperwork",
        required: true,
        allowNotRequired: true,
      });
      expect(checklistCreate.status).toBe(200);
      checklistItemId = checklistCreate.body.item?.id ?? null;
      expect(checklistItemId).toBeTruthy();

      await page.reload({ waitUntil: "networkidle" });

      const checklistCard = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
      await expect(checklistCard).toBeVisible();
      await checklistCard.getByTestId(`vehicle-checklist-edit-toggle-${checklistItemId}`).click();
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-label-${checklistItemId}`)
        .fill(updatedLabel);
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-expiration-${checklistItemId}`)
        .fill("2026-12-31");
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-required-${checklistItemId}`)
        .uncheck();
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-save-${checklistItemId}`)
        .click();

      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "Checklist item updated.",
      );
      await expect(checklistCard).toContainText(updatedLabel);
      await expect(checklistCard).toContainText("Expiration: 2026-12-31");
      await expect(checklistCard.getByText("Required", { exact: true })).toHaveCount(0);
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-edit-toggle-${checklistItemId}`),
      ).toContainText("Edit");
    } finally {
      if (checklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${checklistItemId}`).catch(
          () => undefined,
        );
      }
    }
  });

  test("@tour desktop renamed template items keep expiry requirements", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    const stamp = Date.now();
    const renamedLabel = `Codex Renamed Insurance ${stamp}`;
    const fileLabel = `Codex Template File ${stamp}`;
    let originalSettings: Record<string, unknown> | null = null;
    let checklistItemId: string | null = null;
    let documentId: string | null = null;

    try {
      const settingsResponse = await browserGet<{
        settings?: Record<string, unknown> & {
          vehicleChecklistTemplates?: Array<Record<string, unknown>>;
        };
      }>(page, "/api/admin/settings");
      expect(settingsResponse.status).toBe(200);
      originalSettings = settingsResponse.body.settings ?? null;
      expect(originalSettings).toBeTruthy();

      const originalTemplates = Array.isArray(originalSettings?.vehicleChecklistTemplates)
        ? originalSettings.vehicleChecklistTemplates
        : [];
      const normalizedTemplates =
        originalTemplates.length > 0
          ? originalTemplates.map((template) => {
              if (String(template.key ?? "").trim().toLowerCase() !== "insurance-certificate") {
                return template;
              }
              return {
                ...template,
                label: "Insurance Certificate",
                folder: "Insurance",
                required: true,
                allowNotRequired: true,
                expiryRequired: true,
                expiryWarningDays: 30,
                isActive: true,
              };
            })
          : [
              {
                key: "insurance-certificate",
                label: "Insurance Certificate",
                folder: "Insurance",
                required: true,
                allowNotRequired: true,
                expiryRequired: true,
                expiryWarningDays: 30,
                isActive: true,
              },
            ];
      const hasInsuranceTemplate = normalizedTemplates.some(
        (template) =>
          String(template.key ?? "").trim().toLowerCase() === "insurance-certificate",
      );
      const nextTemplates = hasInsuranceTemplate
        ? normalizedTemplates
        : [
            ...normalizedTemplates,
            {
              key: "insurance-certificate",
              label: "Insurance Certificate",
              folder: "Insurance",
              required: true,
              allowNotRequired: true,
              expiryRequired: true,
              expiryWarningDays: 30,
              isActive: true,
            },
          ];

      const settingsPatch = await browserPatch<{
        ok?: boolean;
        settings?: Record<string, unknown>;
      }>(page, "/api/admin/settings", {
        settings: {
          ...originalSettings,
          vehicleChecklistTemplates: nextTemplates,
        },
      });
      expect(settingsPatch.status).toBe(200);
      expect(settingsPatch.body.ok).toBe(true);

      const checklistCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: "Insurance Certificate",
        folder: "Insurance",
        required: true,
        allowNotRequired: true,
        templateKey: "insurance-certificate",
      });
      expect(checklistCreate.status).toBe(200);
      checklistItemId = checklistCreate.body.item?.id ?? null;
      expect(checklistItemId).toBeTruthy();

      const fileCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/documents`,
        {
          folder: "Insurance",
          documentType: "Insurance Certificate",
          label: fileLabel,
          title: `${fileLabel}.pdf`,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: "9333d8c9-4933-44bf-9f13-bf6f8113ef3d",
          checklistItemId,
        },
      );
      expect(fileCreate.status).toBe(200);
      documentId = fileCreate.body.item?.id ?? null;
      expect(documentId).toBeTruthy();

      await page.reload({ waitUntil: "networkidle" });

      const checklistCard = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
      await expect(checklistCard).toBeVisible();
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-status-${checklistItemId}`),
      ).toContainText("Expiration needed");
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-status-${checklistItemId}`),
      ).not.toContainText("Missing file");

      await checklistCard.getByTestId(`vehicle-checklist-edit-toggle-${checklistItemId}`).click();
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-label-${checklistItemId}`)
        .fill(renamedLabel);
      await checklistCard.getByTestId(`vehicle-checklist-edit-save-${checklistItemId}`).click();

      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "Checklist item updated.",
      );
      await expect(checklistCard).toContainText(renamedLabel);
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-status-${checklistItemId}`),
      ).toContainText("Expiration needed");
      await expect(checklistCard).toContainText(`Attached file: ${fileLabel}`);
    } finally {
      if (originalSettings) {
        await browserPatch(page, "/api/admin/settings", {
          settings: originalSettings,
        }).catch(() => undefined);
      }
      if (documentId) {
        await browserPatch(page, `/api/admin/vehicles/${VEHICLE_ID}/documents/${documentId}`, {
          archived: true,
        }).catch(() => undefined);
      }
      if (checklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${checklistItemId}`).catch(
          () => undefined,
        );
      }
    }
  });

  test("@tour desktop legacy checklist items can regain template warnings", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    const stamp = Date.now();
    const legacyLabel = `Codex Legacy Insurance ${stamp}`;
    const fileLabel = `Codex Legacy File ${stamp}`;
    let originalSettings: Record<string, unknown> | null = null;
    let checklistItemId: string | null = null;
    let documentId: string | null = null;

    try {
      const settingsResponse = await browserGet<{
        settings?: Record<string, unknown> & {
          vehicleChecklistTemplates?: Array<Record<string, unknown>>;
        };
      }>(page, "/api/admin/settings");
      expect(settingsResponse.status).toBe(200);
      originalSettings = settingsResponse.body.settings ?? null;
      expect(originalSettings).toBeTruthy();

      const originalTemplates = Array.isArray(originalSettings?.vehicleChecklistTemplates)
        ? originalSettings.vehicleChecklistTemplates
        : [];
      const normalizedTemplates =
        originalTemplates.length > 0
          ? originalTemplates.map((template) => {
              if (String(template.key ?? "").trim().toLowerCase() !== "insurance-certificate") {
                return template;
              }
              return {
                ...template,
                label: "Insurance Certificate",
                folder: "Insurance",
                required: true,
                allowNotRequired: true,
                expiryRequired: true,
                expiryWarningDays: 30,
                isActive: true,
              };
            })
          : [
              {
                key: "insurance-certificate",
                label: "Insurance Certificate",
                folder: "Insurance",
                required: true,
                allowNotRequired: true,
                expiryRequired: true,
                expiryWarningDays: 30,
                isActive: true,
              },
            ];
      const hasInsuranceTemplate = normalizedTemplates.some(
        (template) =>
          String(template.key ?? "").trim().toLowerCase() === "insurance-certificate",
      );
      const nextTemplates = hasInsuranceTemplate
        ? normalizedTemplates
        : [
            ...normalizedTemplates,
            {
              key: "insurance-certificate",
              label: "Insurance Certificate",
              folder: "Insurance",
              required: true,
              allowNotRequired: true,
              expiryRequired: true,
              expiryWarningDays: 30,
              isActive: true,
            },
          ];
      const settingsPatch = await browserPatch<{
        ok?: boolean;
      }>(page, "/api/admin/settings", {
        settings: {
          ...originalSettings,
          vehicleChecklistTemplates: nextTemplates,
        },
      });
      expect(settingsPatch.status).toBe(200);
      expect(settingsPatch.body.ok).toBe(true);

      const checklistCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: legacyLabel,
        folder: "Insurance",
        required: true,
        allowNotRequired: true,
      });
      expect(checklistCreate.status).toBe(200);
      checklistItemId = checklistCreate.body.item?.id ?? null;
      expect(checklistItemId).toBeTruthy();

      const fileCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/documents`,
        {
          folder: "Insurance",
          documentType: "Insurance Certificate",
          label: fileLabel,
          title: `${fileLabel}.pdf`,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: "ab183c61-9c09-4316-8e44-a213108306f1",
          checklistItemId,
        },
      );
      expect(fileCreate.status).toBe(200);
      documentId = fileCreate.body.item?.id ?? null;
      expect(documentId).toBeTruthy();

      await page.reload({ waitUntil: "networkidle" });

      const checklistCard = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
      await expect(checklistCard).toBeVisible();
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-status-${checklistItemId}`),
      ).toContainText("Ready");

      await checklistCard.getByTestId(`vehicle-checklist-edit-toggle-${checklistItemId}`).click();
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-template-${checklistItemId}`)
        .selectOption("insurance-certificate");
      await checklistCard.getByTestId(`vehicle-checklist-edit-save-${checklistItemId}`).click();

      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "Checklist item updated.",
      );
      await expect(checklistCard).toContainText("Template linked: Insurance Certificate");
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-status-${checklistItemId}`),
      ).toContainText("Expiration needed");
    } finally {
      if (originalSettings) {
        await browserPatch(page, "/api/admin/settings", {
          settings: originalSettings,
        }).catch(() => undefined);
      }
      if (documentId) {
        await browserPatch(page, `/api/admin/vehicles/${VEHICLE_ID}/documents/${documentId}`, {
          archived: true,
        }).catch(() => undefined);
      }
      if (checklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${checklistItemId}`).catch(
          () => undefined,
        );
      }
    }
  });

  test("@tour desktop bulk repair can persist matched legacy template links", async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    const stamp = Date.now();
    const renamedLabel = `Codex Bulk Repair ${stamp}`;
    const fileLabel = `Codex Bulk Repair File ${stamp}`;
    let originalSettings: Record<string, unknown> | null = null;
    let checklistItemId: string | null = null;
    let documentId: string | null = null;

    try {
      const settingsResponse = await browserGet<{
        settings?: Record<string, unknown> & {
          vehicleChecklistTemplates?: Array<Record<string, unknown>>;
        };
      }>(page, "/api/admin/settings");
      expect(settingsResponse.status).toBe(200);
      originalSettings = settingsResponse.body.settings ?? null;
      expect(originalSettings).toBeTruthy();

      const originalTemplates = Array.isArray(originalSettings?.vehicleChecklistTemplates)
        ? originalSettings.vehicleChecklistTemplates
        : [];
      const normalizedTemplates =
        originalTemplates.length > 0
          ? originalTemplates.map((template) => {
              if (String(template.key ?? "").trim().toLowerCase() !== "insurance-certificate") {
                return template;
              }
              return {
                ...template,
                label: "Insurance Certificate",
                folder: "Insurance",
                required: true,
                allowNotRequired: true,
                expiryRequired: true,
                expiryWarningDays: 30,
                isActive: true,
              };
            })
          : [
              {
                key: "insurance-certificate",
                label: "Insurance Certificate",
                folder: "Insurance",
                required: true,
                allowNotRequired: true,
                expiryRequired: true,
                expiryWarningDays: 30,
                isActive: true,
              },
            ];
      const hasInsuranceTemplate = normalizedTemplates.some(
        (template) =>
          String(template.key ?? "").trim().toLowerCase() === "insurance-certificate",
      );
      const nextTemplates = hasInsuranceTemplate
        ? normalizedTemplates
        : [
            ...normalizedTemplates,
            {
              key: "insurance-certificate",
              label: "Insurance Certificate",
              folder: "Insurance",
              required: true,
              allowNotRequired: true,
              expiryRequired: true,
              expiryWarningDays: 30,
              isActive: true,
            },
          ];
      const settingsPatch = await browserPatch<{ ok?: boolean }>(page, "/api/admin/settings", {
        settings: {
          ...originalSettings,
          vehicleChecklistTemplates: nextTemplates,
        },
      });
      expect(settingsPatch.status).toBe(200);
      expect(settingsPatch.body.ok).toBe(true);

      const checklistCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: "Insurance Certificate",
        folder: "Insurance",
        required: true,
        allowNotRequired: true,
      });
      expect(checklistCreate.status).toBe(200);
      checklistItemId = checklistCreate.body.item?.id ?? null;
      expect(checklistItemId).toBeTruthy();

      const fileCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/documents`,
        {
          folder: "Insurance",
          documentType: "Insurance Certificate",
          label: fileLabel,
          title: `${fileLabel}.pdf`,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: "c3cb274e-4d61-46da-9450-1e1f74f92872",
          checklistItemId,
        },
      );
      expect(fileCreate.status).toBe(200);
      documentId = fileCreate.body.item?.id ?? null;
      expect(documentId).toBeTruthy();

      await page.reload({ waitUntil: "networkidle" });

      const checklistCard = page.getByTestId(`vehicle-checklist-item-${checklistItemId}`);
      await expect(checklistCard).toBeVisible();
      await expect(checklistCard).not.toContainText("Template linked:");
      await expect(page.getByTestId("vehicle-checklist-template-repair-banner")).toBeVisible();
      await page.getByTestId("vehicle-checklist-template-repair-action").click();
      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "template link",
      );
      await expect(page.getByTestId("vehicle-checklist-template-repair-banner")).not.toBeVisible();
      await expect(checklistCard).toContainText("Template linked: Insurance Certificate");

      await checklistCard.getByTestId(`vehicle-checklist-edit-toggle-${checklistItemId}`).click();
      await checklistCard
        .getByTestId(`vehicle-checklist-edit-label-${checklistItemId}`)
        .fill(renamedLabel);
      await checklistCard.getByTestId(`vehicle-checklist-edit-save-${checklistItemId}`).click();

      await expect(page.getByTestId("vehicle-checklist-message")).toContainText(
        "Checklist item updated.",
      );
      await expect(checklistCard).toContainText(renamedLabel);
      await expect(
        checklistCard.getByTestId(`vehicle-checklist-status-${checklistItemId}`),
      ).toContainText("Expiration needed");
    } finally {
      if (originalSettings) {
        await browserPatch(page, "/api/admin/settings", {
          settings: originalSettings,
        }).catch(() => undefined);
      }
      if (documentId) {
        await browserPatch(page, `/api/admin/vehicles/${VEHICLE_ID}/documents/${documentId}`, {
          archived: true,
        }).catch(() => undefined);
      }
      if (checklistItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${checklistItemId}`).catch(
          () => undefined,
        );
      }
    }
  });

  test("@tour desktop checklist surfaces attention states", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(150_000);
    test.skip(testInfo.project.name !== "desktop", "Desktop-only verification for stable selectors.");

    await authenticateAdmin(page);
    await page.goto(`/admin/vehicles/${VEHICLE_ID}?tab=checklist`, { waitUntil: "networkidle" });

    const stamp = Date.now();
    const missingFileLabel = `Codex Missing File ${stamp}`;
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 1);
    const expiredValue = expiredDate.toISOString().slice(0, 10);
    let missingFileItemId: string | null = null;
    let expiringItemId: string | null = null;
    let expiringDocumentId: string | null = null;

    try {
      const missingFileCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: missingFileLabel,
        folder: "Paperwork",
        required: true,
        allowNotRequired: false,
      });
      expect(missingFileCreate.status).toBe(200);
      missingFileItemId = missingFileCreate.body.item?.id ?? null;
      expect(missingFileItemId).toBeTruthy();

      const expiringItemCreate = await browserPost<{
        ok?: boolean;
        item?: { id?: string | null };
      }>(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
        label: "Insurance Certificate",
        folder: "Insurance",
        required: true,
        allowNotRequired: true,
        expirationDate: expiredValue,
      });
      expect(expiringItemCreate.status).toBe(200);
      expiringItemId = expiringItemCreate.body.item?.id ?? null;
      expect(expiringItemId).toBeTruthy();

      const expiringFileCreate = await browserPost<{ ok?: boolean; item?: { id?: string | null } }>(
        page,
        `/api/admin/vehicles/${VEHICLE_ID}/documents`,
        {
          folder: "Insurance",
          documentType: "Insurance Certificate",
          label: `Codex Insurance ${stamp}`,
          title: `Codex Insurance ${stamp}.pdf`,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: "d99d5f6d-efcb-4f4e-8db5-4f5a46ce1c11",
          checklistItemId: expiringItemId,
        },
      );
      expect(expiringFileCreate.status).toBe(200);
      expiringDocumentId = expiringFileCreate.body.item?.id ?? null;
      expect(expiringDocumentId).toBeTruthy();

      await page.reload({ waitUntil: "networkidle" });

      await expect(page.getByTestId("vehicle-checklist-summary")).toBeVisible();
      await expect(page.getByTestId("vehicle-checklist-summary")).toContainText("Needs attention");

      const missingFileCard = page.getByTestId(`vehicle-checklist-item-${missingFileItemId}`);
      await expect(missingFileCard).toBeVisible();
      await expect(missingFileCard.getByTestId(`vehicle-checklist-status-${missingFileItemId}`)).toContainText(
        "Missing file",
      );

      const expiringCard = page.getByTestId(`vehicle-checklist-item-${expiringItemId}`);
      await expect(expiringCard).toBeVisible();
      await expect(expiringCard.getByTestId(`vehicle-checklist-status-${expiringItemId}`)).toContainText(
        "Expired",
      );
    } finally {
      if (expiringDocumentId) {
        await browserPatch(page, `/api/admin/vehicles/${VEHICLE_ID}/documents/${expiringDocumentId}`, {
          archived: true,
        }).catch(() => undefined);
      }
      if (missingFileItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${missingFileItemId}`).catch(
          () => undefined,
        );
      }
      if (expiringItemId) {
        await browserDelete(page, `/api/admin/vehicles/${VEHICLE_ID}/checklist/${expiringItemId}`).catch(
          () => undefined,
        );
      }
    }
  });
});
