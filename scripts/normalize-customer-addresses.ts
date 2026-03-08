#!/usr/bin/env tsx

import path from "node:path";

import dotenv from "dotenv";
import { Pool } from "pg";

import { resolveStoredRegionCountry } from "../src/lib/jamaicaParishes";

type CustomerRow = {
  id: string;
  full_name: string | null;
  state: string | null;
  country: string | null;
};

type ScriptDbClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: () => void;
};

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

async function columnExists(
  client: ScriptDbClient,
  tableName: string,
  columnName: string,
) {
  const result = await client.query(
    `select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2
    ) as exists`,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

async function main() {
  loadEnv();

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const client = (await pool.connect()) as ScriptDbClient;

  try {
    const hasZipColumn = await columnExists(client, "customers", "zip");
    const result = (await client.query(
      "select id, full_name, state, country from customers where coalesce(state, '') = '' and coalesce(country, '') <> '' order by full_name asc nulls last, id asc",
    )) as { rows: CustomerRow[] };

    const updates = result.rows
      .map((row) => {
        const normalized = resolveStoredRegionCountry(row.state, row.country);
        if (!normalized.region || !normalized.country) return null;
        if (normalized.region === row.state && normalized.country === row.country) return null;
        return {
          id: row.id,
          fullName: row.full_name ?? "(unknown)",
          fromState: row.state,
          fromCountry: row.country,
          toState: normalized.region,
          toCountry: normalized.country,
        };
      })
      .filter((row) => row !== null);

    if (!apply) {
      console.log(JSON.stringify({ mode: "dry-run", count: updates.length, updates }, null, 2));
      return;
    }

    await client.query("begin");

    for (const update of updates) {
      if (hasZipColumn) {
        await client.query(
          "update customers set state = $2, country = $3, zip = null where id = $1",
          [update.id, update.toState, update.toCountry],
        );
      } else {
        await client.query(
          "update customers set state = $2, country = $3 where id = $1",
          [update.id, update.toState, update.toCountry],
        );
      }
    }

    await client.query("commit");
    console.log(JSON.stringify({ mode: "apply", count: updates.length, updates }, null, 2));
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback failures after connection-level errors.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Customer address normalization failed: ${message}`);
  process.exit(1);
});
