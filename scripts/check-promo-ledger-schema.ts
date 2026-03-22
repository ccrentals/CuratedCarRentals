#!/usr/bin/env tsx

import path from "node:path";

import dotenv from "dotenv";
import { Client } from "pg";

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function normalizeDatabaseUrl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const params = url.searchParams;
    const libpqCompat = params.get("uselibpqcompat") === "true";

    if (libpqCompat) {
      if (!params.get("sslmode")) params.set("sslmode", "require");
      url.search = params.toString();
      return url.toString();
    }

    const sslmode = (params.get("sslmode") ?? "").toLowerCase();
    if (!sslmode) {
      params.set("sslmode", "verify-full");
    } else if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      params.set("sslmode", "verify-full");
    }

    url.search = params.toString();
    return url.toString();
  } catch {
    return connectionString;
  }
}

async function main() {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = new Client({ connectionString: normalizeDatabaseUrl(databaseUrl) });

  try {
    await client.connect();

    const result = await client.query(
      "select to_regclass('public.promo_redemption_events') is not null as exists",
    );

    const existsValue = (result.rows[0] as { exists?: unknown } | undefined)?.exists;
    const exists =
      existsValue === true ||
      existsValue === "t" ||
      existsValue === "true" ||
      existsValue === 1;

    if (!exists) {
      throw new Error("Required table public.promo_redemption_events is missing.");
    }

    console.log("Promo ledger schema check passed: public.promo_redemption_events exists.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Promo ledger schema check failed: ${message}`);
  process.exit(1);
});
