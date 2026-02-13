import { Pool } from "pg";

function createPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10000,
  });
}

let pool: ReturnType<typeof createPool> | null = null;

function normalizeDatabaseUrl(connectionString: string) {
  // pg/pg-connection-string currently treats sslmode=require|prefer|verify-ca as aliases for verify-full.
  // To keep that behavior (and silence the deprecation warning), normalize to sslmode=verify-full unless
  // the user explicitly opts into libpq-compatible semantics via `uselibpqcompat=true`.
  try {
    const url = new URL(connectionString);
    const params = url.searchParams;
    const libpqCompat = params.get("uselibpqcompat") === "true";

    if (libpqCompat) {
      // Do not override sslmode semantics; default to `require` if missing.
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
    // Fallback for unexpected/invalid connection strings.
    if (/[?&]uselibpqcompat=true/i.test(connectionString)) {
      if (!/[?&]sslmode=/i.test(connectionString)) {
        const separator = connectionString.includes("?") ? "&" : "?";
        return `${connectionString}${separator}sslmode=require`;
      }
      return connectionString;
    }

    if (!/[?&]sslmode=/i.test(connectionString)) {
      const separator = connectionString.includes("?") ? "&" : "?";
      return `${connectionString}${separator}sslmode=verify-full`;
    }

    return connectionString.replace(
      /([?&]sslmode=)(require|prefer|verify-ca)\b/i,
      "$1verify-full",
    );
  }
}

export function getDbPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  pool = createPool(normalizeDatabaseUrl(connectionString));

  return pool;
}

export async function dbQuery<T = unknown>(text: string, params: unknown[] = []) {
  const db = getDbPool();
  const result = await db.query(text, params);
  return result as typeof result & { rows: T[] };
}
