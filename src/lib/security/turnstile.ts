import { TURNSTILE_DEV_BYPASS_TOKEN, type TurnstileAction } from "@/lib/security/turnstileShared";

const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileSiteverifyResponse = {
  success?: boolean;
  action?: string;
  "error-codes"?: string[];
};

export type TurnstileVerificationResult =
  | {
      ok: true;
      bypassed: boolean;
    }
  | {
      ok: false;
      status: number;
      userMessage: string;
      errorCodes: string[];
    };

function readEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function isTurnstileConfigured() {
  return (
    readEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY").length > 0 && readEnv("TURNSTILE_SECRET_KEY").length > 0
  );
}

function isDevelopmentBypassMode() {
  return process.env.NODE_ENV !== "production" && !isTurnstileConfigured();
}

export function extractTurnstileToken(body: unknown, request?: Request) {
  const bodyRecord =
    body && typeof body === "object" ? (body as Record<string, unknown>) : ({} as Record<string, unknown>);
  const bodyToken =
    normalizeText(bodyRecord.turnstileToken) ||
    normalizeText(bodyRecord.cfTurnstileToken) ||
    normalizeText(bodyRecord["cf-turnstile-response"]);
  if (bodyToken) return bodyToken;

  if (request) {
    const headerToken = normalizeText(request.headers.get("cf-turnstile-response"));
    if (headerToken) return headerToken;
  }

  return "";
}

export function getClientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return null;
}

function makeFailure(status: number, userMessage: string, errorCodes: string[]) {
  return { ok: false as const, status, userMessage, errorCodes };
}

export async function verifyTurnstileToken(input: {
  token: string | null | undefined;
  remoteIp?: string | null;
  expectedAction: TurnstileAction;
}): Promise<TurnstileVerificationResult> {
  const token = normalizeText(input.token);

  if (isDevelopmentBypassMode()) {
    if (!token || token === TURNSTILE_DEV_BYPASS_TOKEN) {
      return { ok: true, bypassed: true };
    }
  }

  if (!isTurnstileConfigured()) {
    return makeFailure(
      503,
      "Security verification is unavailable. Please try again shortly.",
      ["turnstile_not_configured"],
    );
  }

  if (!token) {
    return makeFailure(
      400,
      "Please complete the security check and try again.",
      ["missing_input_response"],
    );
  }

  const form = new URLSearchParams();
  form.set("secret", readEnv("TURNSTILE_SECRET_KEY"));
  form.set("response", token);
  const remoteIp = normalizeText(input.remoteIp);
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }

  let response: Response;
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return makeFailure(
      502,
      "Could not verify the security check. Please try again.",
      ["turnstile_request_failed"],
    );
  }

  if (!response.ok) {
    return makeFailure(
      502,
      "Could not verify the security check. Please try again.",
      ["turnstile_http_error"],
    );
  }

  const payload = (await response.json().catch(() => ({}))) as TurnstileSiteverifyResponse;
  const errorCodes = Array.isArray(payload["error-codes"])
    ? payload["error-codes"].filter((value): value is string => typeof value === "string")
    : [];

  if (!payload.success) {
    return makeFailure(
      403,
      "Security check failed. Please retry and submit again.",
      errorCodes.length > 0 ? errorCodes : ["turnstile_rejected"],
    );
  }

  if (payload.action && payload.action !== input.expectedAction) {
    return makeFailure(403, "Security check failed. Please retry and submit again.", [
      "turnstile_action_mismatch",
    ]);
  }

  return { ok: true, bypassed: false };
}
