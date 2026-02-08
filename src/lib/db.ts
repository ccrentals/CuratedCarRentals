import { Pool } from "pg";

let pool: any = null;

function normalizeDatabaseUrl(url: string) {
  if (/[?&]sslmode=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}sslmode=verify-full`;
}

export function getDbPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  pool = new Pool({
    connectionString: normalizeDatabaseUrl(connectionString),
    max: 5,
    idleTimeoutMillis: 10000,
  });

  return pool;
}

export async function dbQuery<T = unknown>(text: string, params: unknown[] = []) {
  const db = getDbPool();
  const result = await db.query(text, params);
  return result as typeof result & { rows: T[] };
}
