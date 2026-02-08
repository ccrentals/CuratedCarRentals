const SENSITIVE_KEY =
  /(secret|token|password|authorization|cookie|session|api[_-]?key|key|email|phone|account(_|-)?number)$/i;

export function redactText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\bre_[A-Za-z0-9]+\b/g, "re_[REDACTED]")
    .replace(/\bt_[A-Za-z0-9_-]+\b/g, "t_[REDACTED]")
    .replace(/\bsk_[A-Za-z0-9_-]+\b/g, "sk_[REDACTED]");
}

function safeString(value: string) {
  const trimmed = redactText(value).trim();
  if (trimmed.length <= 500) return trimmed;
  return `${trimmed.slice(0, 500)}…`;
}

function redactValue(value: unknown, key?: string, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 4) return "[TRUNCATED]";

  if (typeof value === "string") return safeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, undefined, depth + 1));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj).slice(0, 50);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = redactValue(v, k, depth + 1);
    return out;
  }

  return safeString(String(value));
}

export function safeErrorMessage(error: unknown) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return safeString(error.message || error.name || "Error");
  return safeString(String(error));
}

export function redact(extra?: Record<string, unknown>) {
  if (!extra) return undefined;
  return redactValue(extra) as Record<string, unknown>;
}

export function logError(context: string, error: unknown, extra?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    level: "error",
    context,
    message: safeErrorMessage(error),
  };

  const redacted = redact(extra);
  if (redacted && Object.keys(redacted).length) payload.extra = redacted;

  if (process.env.NODE_ENV !== "production" && error instanceof Error && error.stack) {
    payload.stack = safeString(error.stack);
  }

  // Next's dev overlay often shows `{}` for object-only logs; include a readable summary first.
  console.error(`[${context}] ${payload.message}`, payload);
}

export function logWarn(context: string, extra?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    level: "warn",
    context,
  };
  const redacted = redact(extra);
  if (redacted && Object.keys(redacted).length) payload.extra = redacted;
  console.warn(`[${context}]`, payload);
}
