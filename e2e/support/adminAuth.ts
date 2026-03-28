import { createHmac, randomUUID } from "node:crypto";

import { test, type Page } from "@playwright/test";
import { Client } from "pg";

import {
  E2E_ADMIN_ACTOR_ID,
  E2E_ADMIN_IDENTIFIER,
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_SESSION_SECRET,
  E2E_BASE_URL,
  E2E_DATABASE_URL,
} from "./env";
import { maybeReadE2EFixtures } from "./fixtures";

let cachedActorIdPromise: Promise<string | null> | null = null;

function createSessionToken(userId: string, role: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 20;
  const payload = JSON.stringify({ sub: userId, role, exp: expiresAt, iat: issuedAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", E2E_ADMIN_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readActorIdFromFixtures() {
  const fixtures = maybeReadE2EFixtures();
  const actorId = fixtures?.adminUser?.id?.trim();
  return actorId ? actorId : null;
}

export async function resolveAdminActorId(preferredActorId?: string | null) {
  const preferred = preferredActorId?.trim();
  if (preferred) return preferred;
  if (cachedActorIdPromise) return cachedActorIdPromise;

  cachedActorIdPromise = (async () => {
    const envActorId = E2E_ADMIN_ACTOR_ID.trim();
    if (envActorId) return envActorId;

    const fixtureActorId = readActorIdFromFixtures();
    if (fixtureActorId) return fixtureActorId;

    if (!E2E_DATABASE_URL) return null;

    const client = new Client({ connectionString: E2E_DATABASE_URL });
    try {
      await client.connect();
      const result = await client.query(
        "select id from users where role in ('ADMIN', 'DEVELOPER') order by created_at asc limit 1",
      );
      const firstRow = result.rows[0] as { id?: string } | undefined;
      return firstRow?.id ?? null;
    } finally {
      await client.end().catch(() => undefined);
    }
  })();

  return cachedActorIdPromise;
}

export async function signInWithForm(page: Page) {
  test.skip(
    !E2E_ADMIN_IDENTIFIER || !E2E_ADMIN_PASSWORD,
    "Set E2E admin login credentials.",
  );

  await page.goto("/admin/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email or username").fill(E2E_ADMIN_IDENTIFIER);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(
    (url) => {
      const route = url.pathname;
      return route.startsWith("/admin") && route !== "/admin/login";
    },
    { timeout: 20_000 },
  );
}

export async function authenticateAdmin(
  page: Page,
  options: {
    actorId?: string | null;
    allowRandomActor?: boolean;
  } = {},
) {
  if (E2E_ADMIN_SESSION_SECRET) {
    const actorId =
      (await resolveAdminActorId(options.actorId)) ??
      (options.allowRandomActor ? randomUUID() : null);

    if (actorId) {
      const token = createSessionToken(actorId, "ADMIN");
      await page.context().addCookies([
        {
          name: "ccr_admin_session",
          value: token,
          url: E2E_BASE_URL,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await page.goto("/admin", { waitUntil: "networkidle" });
      const route = new URL(page.url()).pathname;
      if (route.startsWith("/admin") && route !== "/admin/login") {
        return;
      }

      if (!E2E_ADMIN_IDENTIFIER || !E2E_ADMIN_PASSWORD) {
        test.skip(
          true,
          "Admin cookie auth was rejected and no E2E admin login credentials were provided.",
        );
      }
    }
  }

  test.skip(
    !E2E_ADMIN_IDENTIFIER || !E2E_ADMIN_PASSWORD,
    "Set ADMIN_SESSION_SECRET with a resolvable admin actor id, or provide E2E admin login credentials.",
  );
  await signInWithForm(page);
}
