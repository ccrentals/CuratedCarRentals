#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

function loadEnv() {
  // Local convenience; does not override existing env vars.
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function normalizeDatabaseUrl(connectionString) {
  // Keep behavior explicit and future-proof:
  // - If `uselibpqcompat=true`, do not override sslmode semantics.
  // - Otherwise, prefer `sslmode=verify-full` to match current pg behavior.
  try {
    const url = new URL(connectionString);
    const params = url.searchParams;
    const libpqCompat = params.get("uselibpqcompat") === "true";

    if (libpqCompat) {
      if (!params.get("sslmode")) params.set("sslmode", "require");
      url.search = params.toString();
      return url.toString();
    }

    const sslmode = params.get("sslmode");
    if (!sslmode) {
      params.set("sslmode", "verify-full");
    } else if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      params.set("sslmode", "verify-full");
    }

    url.search = params.toString();
    return url.toString();
  } catch {
    // Fallback: keep the original string if parsing fails.
    return connectionString;
  }
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id serial primary key,
      name text not null unique,
      applied_at timestamptz not null default now()
    );
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

async function getAppliedMigrations(client) {
  const result = await client.query("select name from schema_migrations order by id asc");
  return new Set(result.rows.map((r) => String(r.name)));
}

async function applyMigration(client, name, sql) {
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (name) values ($1) on conflict do nothing", [
      name,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  loadEnv();

  const rawConnectionString = process.env.DATABASE_URL;
  if (!rawConnectionString) {
    console.error("Missing DATABASE_URL; set it in the environment (or .env.local) and retry.");
    process.exit(1);
  }

  const connectionString = normalizeDatabaseUrl(rawConnectionString);
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 5000 });

  const client = await pool.connect();
  try {
    await ensureSchemaMigrationsTable(client);

    const files = listMigrationFiles();
    const applied = await getAppliedMigrations(client);

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log(`Applying ${pending.length} migration(s)...`);

    for (const file of pending) {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, "utf8");

      console.log(`- ${file}`);
      await applyMigration(client, file, sql);
    }

    console.log("Migrations applied successfully.");
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exit(1);
});
