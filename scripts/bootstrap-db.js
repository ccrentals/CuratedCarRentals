#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");
const { Pool } = require("pg");

const CORE_TABLES = ["bookings", "customers", "payments", "users", "vehicles"];
const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");
const SCHEMA_PATH = path.join(process.cwd(), "db", "schema.sql");

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function normalizeDatabaseUrl(connectionString) {
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
    return connectionString;
  }
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

async function getExistingCoreTables(client) {
  const result = await client.query(
    `select tablename
       from pg_tables
      where schemaname = current_schema()
        and tablename = any($1::text[])
      order by tablename`,
    [CORE_TABLES],
  );
  return result.rows.map((row) => String(row.tablename));
}

async function baselineMigrations(client, files) {
  await client.query(`
    create table if not exists schema_migrations (
      id serial primary key,
      name text not null unique,
      applied_at timestamptz not null default now()
    )
  `);

  for (const file of files) {
    await client.query(
      "insert into schema_migrations (name) values ($1) on conflict (name) do nothing",
      [file],
    );
  }
}

async function main() {
  loadEnv();

  const rawConnectionString = process.env.DATABASE_URL;
  if (!rawConnectionString) {
    throw new Error("Missing DATABASE_URL; set it in the environment and retry.");
  }
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Missing baseline schema: ${SCHEMA_PATH}`);
  }

  const pool = new Pool({
    connectionString: normalizeDatabaseUrl(rawConnectionString),
    max: 1,
    idleTimeoutMillis: 5000,
  });
  const client = await pool.connect();

  try {
    const existingTables = await getExistingCoreTables(client);
    if (existingTables.length === CORE_TABLES.length) {
      console.log("Database already contains the application schema; bootstrap skipped.");
      return;
    }
    if (existingTables.length > 0) {
      throw new Error(
        `Database is partially initialized; refusing automatic bootstrap. Found: ${existingTables.join(", ")}`,
      );
    }

    const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
    const migrationFiles = listMigrationFiles();

    await client.query("begin");
    try {
      console.log("Applying baseline application schema...");
      await client.query(schemaSql);
      await baselineMigrations(client, migrationFiles);
      await client.query("commit");
      console.log(`Database bootstrap complete; baselined ${migrationFiles.length} migration(s).`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Database bootstrap failed: ${message}`);
  process.exit(1);
});
