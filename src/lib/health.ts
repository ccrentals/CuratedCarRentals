import { dbQuery } from "@/lib/db";
import { getFileStorageProvider, getInvoiceProvider, validateEnv, type EnvValidation } from "@/lib/env";
import { redactText } from "@/lib/log";
import { getBunnyStorageConfig } from "@/lib/uploads/bunny";
import { getWiPayBaseUrl } from "@/lib/wipay";

type CheckResult = {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  configured?: boolean;
  error?: string;
};

export type HealthSnapshot = {
  ok: boolean;
  goLiveReady: boolean;
  env: EnvValidation;
  checks: {
    db: CheckResult;
    promoLedger: CheckResult;
    wipay: CheckResult;
    resend: CheckResult;
    pdfmonkey: CheckResult;
    storage: CheckResult & { provider: "uploadcare" | "bunny" };
    netlify: CheckResult & {
      context?: string;
      deployUrl?: string;
    };
  };
  timestamp: string;
};

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function safeSnippet(text: string) {
  return redactText(text).replace(/\s+/g, " ").slice(0, 300);
}

function runtimeCoreOk(env: EnvValidation) {
  const missing = env.core.missing.filter((key) => {
    if (key !== "CSRF_SECRET") return true;
    return process.env.NODE_ENV === "production";
  });
  return missing.length === 0 && env.core.invalid.length === 0;
}

function runtimePublicRecoveryOk(env: EnvValidation) {
  return env.publicRecovery.missing.length === 0 && env.publicRecovery.invalid.length === 0;
}

function strictOk(section: { missing: string[]; invalid: string[] }) {
  return section.missing.length === 0 && section.invalid.length === 0;
}

const CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 5_000;
let cachedSnapshot: { value: HealthSnapshot; expiresAt: number } | null = null;
let inflightSnapshot: Promise<HealthSnapshot> | null = null;

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.expiresAt > now) return cachedSnapshot.value;
  if (inflightSnapshot) return inflightSnapshot;

  inflightSnapshot = (async () => {
  const env = validateEnv();

  const dbCheck = (async () => {
    const started = Date.now();
    const configured = Boolean(process.env.DATABASE_URL?.trim());
    if (!configured) {
      return { ok: false, configured: false, latencyMs: Date.now() - started, error: "DATABASE_URL is not set" };
    }
    try {
      await dbQuery("select 1 as ok");
      return { ok: true, configured: true, latencyMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : "DB error";
      return { ok: false, configured: true, latencyMs: Date.now() - started, error: safeSnippet(message) };
    }
  })();

  const wipayCheck = (async () => {
    const started = Date.now();
    const configured = strictOk(env.payments);
    if (!configured) {
      return { ok: false, configured: false, latencyMs: Date.now() - started };
    }
    try {
      const baseUrl = getWiPayBaseUrl();
      const res = await fetchWithTimeout(baseUrl, 4000, { method: "GET" });
      return { ok: res.status < 500, configured: true, status: res.status, latencyMs: Date.now() - started };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "WiPay connectivity timed out after 4000ms"
          : error instanceof Error
            ? error.message
            : "WiPay fetch failed";
      return {
        ok: false,
        configured: true,
        status: 0,
        latencyMs: Date.now() - started,
        error: safeSnippet(message),
      };
    }
  })();

  const promoLedgerCheck = (async () => {
    const started = Date.now();
    const configured = Boolean(process.env.DATABASE_URL?.trim());
    if (!configured) {
      return {
        ok: false,
        configured: false,
        latencyMs: Date.now() - started,
        error: "DATABASE_URL is not set",
      };
    }

    try {
      const result = await dbQuery(
        "select to_regclass('public.promo_redemption_events') is not null as exists",
      );
      const existsValue = (result.rows[0] as { exists?: unknown } | undefined)?.exists;
      const exists =
        existsValue === true ||
        existsValue === "t" ||
        existsValue === "true" ||
        existsValue === 1;

      return {
        ok: exists,
        configured: true,
        latencyMs: Date.now() - started,
        error: exists ? undefined : "Required table public.promo_redemption_events is missing",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Promo ledger schema check failed";
      return {
        ok: false,
        configured: true,
        latencyMs: Date.now() - started,
        error: safeSnippet(message),
      };
    }
  })();

  const resendCheck = (async () => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return { ok: false, configured: false };
    const started = Date.now();
    try {
      const res = await fetchWithTimeout("https://api.resend.com/domains", 4000, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await res.text().catch(() => "");
      return {
        ok: res.ok,
        configured: true,
        status: res.status,
        latencyMs: Date.now() - started,
        error: res.ok ? undefined : safeSnippet(text || `HTTP ${res.status}`),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resend fetch failed";
      return {
        ok: false,
        configured: true,
        status: 0,
        latencyMs: Date.now() - started,
        error: safeSnippet(message),
      };
    }
  })();

  const invoiceProviderCheck = (async () => {
    const started = Date.now();
    const provider = getInvoiceProvider();

    if (provider === "gotenberg") {
      const gotenbergUrl = (process.env.GOTENBERG_URL ?? "").trim();
      const endpoint = `${(gotenbergUrl || "http://localhost:3001").replace(/\/+$/, "")}/health`;
      const configured = process.env.NODE_ENV === "production" ? Boolean(gotenbergUrl) : true;
      try {
        const response = await fetchWithTimeout(endpoint, 4000, { method: "GET" });
        const text = await response.text().catch(() => "");
        if (!response.ok) {
          return {
            ok: false,
            configured,
            status: response.status,
            latencyMs: Date.now() - started,
            error: safeSnippet(text || `HTTP ${response.status}`),
          };
        }
        let statusUp = true;
        try {
          const payload = JSON.parse(text) as { status?: string };
          if (payload.status) {
            statusUp = payload.status.toLowerCase() === "up";
          }
        } catch {
          statusUp = true;
        }
        return {
          ok: statusUp,
          configured,
          status: response.status,
          latencyMs: Date.now() - started,
          error: statusUp ? undefined : "Gotenberg health endpoint did not report status=up",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gotenberg fetch failed";
        return {
          ok: false,
          configured,
          status: 0,
          latencyMs: Date.now() - started,
          error: safeSnippet(message),
        };
      }
    }

    const apiKey = process.env.PDFMONKEY_API_KEY?.trim();
    const templateId = process.env.PDFMONKEY_TEMPLATE_ID?.trim();
    if (!apiKey || !templateId) return { ok: false, configured: false };
    try {
      // Validate API key (does not consume quota).
      const listRes = await fetchWithTimeout("https://api.pdfmonkey.io/api/v1/documents", 4000, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const listText = await listRes.text().catch(() => "");
      if (!listRes.ok) {
        return {
          ok: false,
          configured: true,
          status: listRes.status,
          latencyMs: Date.now() - started,
          error: safeSnippet(listText || `HTTP ${listRes.status}`),
        };
      }

      // Validate template id.
      const tplRes = await fetchWithTimeout(
        `https://api.pdfmonkey.io/api/v1/document_templates/${encodeURIComponent(templateId)}`,
        4000,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );
      const tplText = await tplRes.text().catch(() => "");
      if (!tplRes.ok) {
        return {
          ok: false,
          configured: true,
          status: tplRes.status,
          latencyMs: Date.now() - started,
          error: safeSnippet(tplText || `HTTP ${tplRes.status}`),
        };
      }

      return { ok: true, configured: true, status: tplRes.status, latencyMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDFMonkey fetch failed";
      return {
        ok: false,
        configured: true,
        status: 0,
        latencyMs: Date.now() - started,
        error: safeSnippet(message),
      };
    }
  })();

  const storageCheck = (async () => {
    const provider = getFileStorageProvider();
    if (provider === "bunny") {
      const started = Date.now();
      try {
        const config = getBunnyStorageConfig("public");
        const response = await fetchWithTimeout(
          `${config.endpoint}/${encodeURIComponent(config.storageZone)}/`,
          4000,
          { method: "GET", headers: { AccessKey: config.accessKey } },
        );
        const text = await response.text().catch(() => "");
        return {
          provider,
          ok: response.ok,
          configured: true,
          status: response.status,
          latencyMs: Date.now() - started,
          error: response.ok ? undefined : safeSnippet(text || `HTTP ${response.status}`),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Bunny Storage fetch failed";
        return {
          provider,
          ok: false,
          configured: strictOk(env.uploads),
          status: 0,
          latencyMs: Date.now() - started,
          error: safeSnippet(message),
        };
      }
    }

    const publicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY?.trim();
    const started = Date.now();
    if (!publicKey) return { provider, ok: false, configured: false };
    try {
      const res = await fetchWithTimeout(
        "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js",
        4000,
        { method: "GET" },
      );
      return {
        provider,
        ok: res.ok,
        configured: true,
        status: res.status,
        latencyMs: Date.now() - started,
        error: res.ok ? undefined : safeSnippet(`HTTP ${res.status}`),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Uploadcare fetch failed";
      return { provider, ok: false, configured: true, status: 0, latencyMs: Date.now() - started, error: safeSnippet(message) };
    }
  })();

  const netlifyCheck = (async () => {
    const context = process.env.CONTEXT ?? process.env.NETLIFY_CONTEXT ?? "";
    const deployUrl = process.env.DEPLOY_URL ?? process.env.URL ?? "";
    const onNetlify = (process.env.NETLIFY ?? "").toLowerCase() === "true" || Boolean(deployUrl);
    return {
      ok: true,
      configured: onNetlify,
      context: context || undefined,
      deployUrl: deployUrl || undefined,
    };
  })();

  const [db, promoLedger, wipay, resend, pdfmonkey, storage, netlify] = await Promise.all([
    dbCheck,
    promoLedgerCheck,
    wipayCheck,
    resendCheck,
    invoiceProviderCheck,
    storageCheck,
    netlifyCheck,
  ]);

  const ok = runtimeCoreOk(env) && runtimePublicRecoveryOk(env) && db.ok && promoLedger.ok;
  const goLiveReady =
    strictOk(env.core) &&
    strictOk(env.publicRecovery) &&
    strictOk(env.payments) &&
    strictOk(env.email) &&
    strictOk(env.invoices) &&
    strictOk(env.uploads) &&
    strictOk(env.cron) &&
    db.ok &&
    promoLedger.ok &&
    wipay.ok &&
    resend.ok &&
    pdfmonkey.ok &&
    storage.ok;

  return {
    ok,
    goLiveReady,
    env,
    checks: { db, promoLedger, wipay, resend, pdfmonkey, storage, netlify },
    timestamp: new Date().toISOString(),
  };
  })();

  try {
    const value = await inflightSnapshot;
    cachedSnapshot = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } finally {
    inflightSnapshot = null;
  }
}
