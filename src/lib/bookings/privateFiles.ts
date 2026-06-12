const SAFE_BOOKING_PRIVATE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export const MAX_BOOKING_PRIVATE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DRIVERS_LICENSE_IMAGES = 4;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMimeType(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

export function isSafeBookingPrivateImageMimeType(value: unknown) {
  return SAFE_BOOKING_PRIVATE_IMAGE_MIME_TYPES.has(normalizeMimeType(value));
}

export function parseSafePrivateBookingImageDataUrl(
  dataUrl: string,
  options: { maxBytes?: number } = {},
) {
  const normalized = normalizeText(dataUrl);
  if (!normalized) return null;

  const match = normalized.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;

  const mimeType = normalizeMimeType(match[1] || "application/octet-stream");
  if (!isSafeBookingPrivateImageMimeType(mimeType)) {
    return null;
  }

  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    const maxBytes = options.maxBytes ?? MAX_BOOKING_PRIVATE_IMAGE_BYTES;
    if (bytes.length < 1 || bytes.length > maxBytes) {
      return null;
    }
    return {
      mimeType,
      bytes,
      normalizedDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

export function resolveSafePrivateBookingResponseMimeType(
  storedMimeType: unknown,
  actualMimeType?: unknown,
) {
  const storedRaw = normalizeMimeType(storedMimeType);
  const actual = normalizeMimeType(actualMimeType);
  const storedIsWildcard = storedRaw === "image/*";

  if (storedRaw && !storedIsWildcard && !isSafeBookingPrivateImageMimeType(storedRaw)) {
    return null;
  }
  if (actual && !isSafeBookingPrivateImageMimeType(actual)) {
    return null;
  }
  if (storedIsWildcard) {
    return actual || null;
  }
  if (storedRaw && actual && storedRaw !== actual) {
    return null;
  }
  return storedRaw || actual || null;
}

export function sanitizePrivateBookingFileName(
  documentType: string,
  originalFileName: string | null,
  mimeType: string,
) {
  const original = normalizeText(originalFileName);
  const compact = original.replace(/[^a-z0-9._-]+/gi, "_");
  const normalized = compact.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized) return normalized;

  const base = documentType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") || "booking_file";
  return `${base}.${extensionForMimeType(mimeType)}`;
}
