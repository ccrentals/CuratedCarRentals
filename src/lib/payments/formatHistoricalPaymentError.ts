export type FormattedPaymentError = {
  title: string;
  detail: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRawErrorMessage(meta: Record<string, unknown> | null) {
  if (!meta) return "";

  const error = isRecord(meta.error) ? meta.error : null;
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();

  const response = isRecord(meta.response) ? meta.response : null;
  if (typeof response?.message === "string" && response.message.trim()) return response.message.trim();
  if (typeof response?.reasonDescription === "string" && response.reasonDescription.trim()) {
    return response.reasonDescription.trim();
  }

  const raw = isRecord(meta.raw) ? meta.raw : null;
  if (typeof raw?.message === "string" && raw.message.trim()) return raw.message.trim();
  if (typeof raw?.reasonDescription === "string" && raw.reasonDescription.trim()) {
    return raw.reasonDescription.trim();
  }

  return "";
}

function paymentProviderLabel(provider: string) {
  const normalized = provider.trim().toUpperCase();
  if (normalized === "WIPAY") return "WiPay";
  if (normalized === "STRIPE") return "Stripe";
  return "Payment provider";
}

function formatStoredPaymentError(
  rawMessage?: string | null,
  provider = "Payment provider",
): FormattedPaymentError | null {
  const message = rawMessage?.trim();
  if (!message) return null;

  const statusMatch = message.match(/\bHTTP\s+(\d{3})\b/i);
  const statusCode = statusMatch ? Number.parseInt(statusMatch[1] ?? "", 10) : null;

  if (statusCode === 522) {
    return {
      title: `${provider} unavailable (HTTP 522)`,
      detail: "Provider timeout / upstream unavailable",
    };
  }

  if (/timed out/i.test(message)) {
    return {
      title: `${provider} unavailable (timeout)`,
      detail: "Provider did not respond before the request timeout",
    };
  }

  if (statusCode !== null && statusCode >= 500 && statusCode <= 599) {
    return {
      title: `${provider} unavailable (HTTP ${statusCode})`,
      detail: "Provider error / upstream unavailable",
    };
  }

  if (statusCode !== null && statusCode >= 400 && statusCode <= 499) {
    return {
      title: `${provider} request failed (HTTP ${statusCode})`,
      detail: "Provider rejected the request",
    };
  }

  if (/(<!DOCTYPE html>|<html\b)/i.test(message)) {
    return {
      title: `${provider} returned an unexpected error page`,
      detail: "Provider returned an invalid payment response",
    };
  }

  return {
    title: `${provider} request failed`,
    detail: "Payment provider error",
  };
}

export function formatStoredHistoricalPaymentError(rawMessage?: string | null) {
  return formatStoredPaymentError(rawMessage, "WiPay");
}

export function formatPaymentMetadataError(meta: Record<string, unknown> | null, provider: string) {
  return formatStoredPaymentError(extractRawErrorMessage(meta), paymentProviderLabel(provider));
}

export function sanitizePaymentMetadataForUi(meta: Record<string, unknown> | null, provider: string) {
  if (!meta) return null;

  const formatted = formatPaymentMetadataError(meta, provider);
  if (!formatted) return meta;

  const next = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
  delete next.response;
  delete next.raw;
  next.error = {
    title: formatted.title,
    detail: formatted.detail,
  };
  return next;
}
