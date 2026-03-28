import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
export const E2E_ADMIN_IDENTIFIER =
  process.env.E2E_ADMIN_IDENTIFIER ??
  process.env.E2E_ADMIN_EMAIL ??
  process.env.E2E_ADMIN_USER ??
  "";
export const E2E_ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASS ?? "";
export const E2E_ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
export const E2E_ADMIN_ACTOR_ID =
  process.env.E2E_ADMIN_ID ??
  process.env.E2E_ADMIN_USER_ID ??
  process.env.ADMIN_ACTOR_ID ??
  "";
export const E2E_DATABASE_URL = process.env.DATABASE_URL ?? "";
