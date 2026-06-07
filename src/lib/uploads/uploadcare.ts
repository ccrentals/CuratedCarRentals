import { createHmac } from "node:crypto";

const UPLOADCARE_FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:~\d+)?$/i;
const TRUSTED_UPLOADCARE_HOSTS = ["ucarecdn.com", "ucarecd.net"] as const;
const DEFAULT_SIGNED_UPLOAD_LIFETIME_SECONDS = 10 * 60;
const UPLOADCARE_REST_ACCEPT = "application/vnd.uploadcare-v0.7+json";
let cachedUploadcareCdnBaseUrl: string | null = null;

export const UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type UploadcareFileMetadata = {
  uuid: string;
  originalFileUrl: string | null;
  size: number;
  mimeType: string;
  isImage: boolean;
  isReady: boolean;
  isStored: boolean;
  isRemoved: boolean;
  originalFilename: string | null;
};

export type UploadcareFilePolicy = {
  label: string;
  maxCount: number;
  maxBytes: number;
  imagesOnly?: boolean;
  allowedMimeTypes?: readonly string[];
};

export class UploadcareFileValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadcareFileValidationError";
    this.status = status;
  }
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isTrustedUploadcareHost(hostname: string) {
  const normalized = normalizeText(hostname).toLowerCase();
  if (!normalized) return false;
  return TRUSTED_UPLOADCARE_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

function resolveConfiguredUploadcareBaseUrl() {
  const configured = normalizeText(process.env.UPLOADCARE_CDN_BASE_URL);
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === "https:" && isTrustedUploadcareHost(parsed.hostname)) {
      return parsed.origin;
    }
  } catch {
    // Fall back to the canonical Uploadcare CDN origin below.
  }
  return null;
}

function resolveTrustedUploadcareBaseUrl() {
  const configured = resolveConfiguredUploadcareBaseUrl();
  if (configured) return configured;
  return "https://ucarecdn.com";
}

export function extractUploadcareFileId(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (UPLOADCARE_FILE_ID_RE.test(normalized)) return normalized;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "https:" && isTrustedUploadcareHost(parsed.hostname)) {
      const pathMatch = parsed.pathname.match(/\/([0-9a-f-]{36}(?:~\d+)?)(?:\/|$)/i);
      if (pathMatch?.[1] && UPLOADCARE_FILE_ID_RE.test(pathMatch[1])) {
        return pathMatch[1];
      }
    }
  } catch {
    const match = normalized.match(
      /^(?:[\w-]+\.)?(?:ucarecdn\.com|ucarecd\.net)\/([0-9a-f-]{36}(?:~\d+)?)(?:[/?#]|$)/i,
    );
    if (match?.[1] && UPLOADCARE_FILE_ID_RE.test(match[1])) {
      return match[1];
    }
  }

  return null;
}

export function extractUploadcareDeliveryUrl(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") return null;
    if (!isTrustedUploadcareHost(parsed.hostname)) return null;
    const pathMatch = parsed.pathname.match(/\/([0-9a-f-]{36}(?:~\d+)?)(?:\/|$)/i);
    const hasFileIdInPath = Boolean(pathMatch?.[1] && UPLOADCARE_FILE_ID_RE.test(pathMatch[1]));
    if (!hasFileIdInPath) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildUploadcareCdnUrl(fileId: string) {
  const normalizedBase = resolveTrustedUploadcareBaseUrl().replace(/\/+$/, "");
  return `${normalizedBase}/${encodeURIComponent(fileId)}/`;
}

export function normalizeUploadcareDeliveryUrl(value: unknown) {
  const fileId = extractUploadcareFileId(value);
  if (!fileId) return null;

  const directUrl = extractUploadcareDeliveryUrl(value);
  if (directUrl) return directUrl;

  return buildUploadcareCdnUrl(fileId);
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

function resolveUploadcarePublicKey(options: { publicKey?: string } = {}) {
  return options.publicKey?.trim() || process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY?.trim() || "";
}

function resolveUploadcareSecretKey(options: { secretKey?: string } = {}) {
  return options.secretKey?.trim() || process.env.UPLOADCARE_SECRET_KEY?.trim() || "";
}

export function createUploadcareSignedUploadCredentials(
  options: {
    publicKey?: string;
    secretKey?: string;
    now?: Date;
    lifetimeSeconds?: number;
  } = {},
) {
  const publicKey = resolveUploadcarePublicKey(options);
  const secretKey = resolveUploadcareSecretKey(options);
  if (!publicKey || !secretKey) {
    throw new Error("Uploadcare signed uploads are not configured.");
  }

  const lifetimeSeconds = Math.max(
    60,
    Math.min(
      60 * 60,
      Math.trunc(options.lifetimeSeconds ?? DEFAULT_SIGNED_UPLOAD_LIFETIME_SECONDS),
    ),
  );
  const secureExpire = String(
    Math.floor((options.now ?? new Date()).getTime() / 1000) + lifetimeSeconds,
  );
  const secureSignature = createHmac("sha256", secretKey)
    .update(secureExpire)
    .digest("hex");

  return {
    publicKey,
    secureSignature,
    secureExpire,
  };
}

export async function getUploadcareFileMetadata(
  fileId: string,
  options: {
    publicKey?: string;
    secretKey?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<UploadcareFileMetadata> {
  const normalizedFileId = extractUploadcareFileId(fileId);
  if (!normalizedFileId) {
    throw new UploadcareFileValidationError("Invalid Uploadcare file reference.");
  }

  const publicKey = resolveUploadcarePublicKey(options);
  const secretKey = resolveUploadcareSecretKey(options);
  if (!publicKey || !secretKey) {
    throw new UploadcareFileValidationError(
      "Uploadcare file verification is not configured.",
      503,
    );
  }

  const response = await (options.fetchFn ?? fetch)(
    `https://api.uploadcare.com/files/${encodeURIComponent(normalizedFileId)}/`,
    {
      headers: {
        Accept: UPLOADCARE_REST_ACCEPT,
        Authorization: `Uploadcare.Simple ${publicKey}:${secretKey}`,
      },
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        uuid?: unknown;
        size?: unknown;
        mime_type?: unknown;
        is_image?: unknown;
        is_ready?: unknown;
        datetime_stored?: unknown;
        datetime_removed?: unknown;
        original_filename?: unknown;
        original_file_url?: unknown;
      }
    | null;

  if (response.status === 404) {
    throw new UploadcareFileValidationError(
      "The uploaded file was not found in this Uploadcare project.",
    );
  }
  if (!response.ok || !payload) {
    throw new UploadcareFileValidationError(
      "Uploadcare could not verify the uploaded file.",
      502,
    );
  }

  const uuid = extractUploadcareFileId(payload.uuid);
  if (!uuid || uuid !== normalizedFileId) {
    throw new UploadcareFileValidationError(
      "Uploadcare returned invalid file metadata.",
      502,
    );
  }

  return {
    uuid,
    originalFileUrl: extractUploadcareDeliveryUrl(payload.original_file_url),
    size:
      typeof payload.size === "number" && Number.isFinite(payload.size)
        ? Math.max(0, Math.round(payload.size))
        : 0,
    mimeType: typeof payload.mime_type === "string" ? payload.mime_type.trim().toLowerCase() : "",
    isImage: payload.is_image === true,
    isReady: payload.is_ready === true,
    isStored: typeof payload.datetime_stored === "string" && Boolean(payload.datetime_stored.trim()),
    isRemoved: Boolean(payload.datetime_removed),
    originalFilename:
      typeof payload.original_filename === "string" && payload.original_filename.trim()
        ? payload.original_filename.trim()
        : null,
  };
}

export async function deleteUploadcareFile(
  fileId: string,
  options: {
    publicKey?: string;
    secretKey?: string;
    fetchFn?: typeof fetch;
  } = {},
) {
  const normalizedFileId = extractUploadcareFileId(fileId);
  if (!normalizedFileId) {
    throw new UploadcareFileValidationError("Invalid Uploadcare file reference.");
  }

  const publicKey = resolveUploadcarePublicKey(options);
  const secretKey = resolveUploadcareSecretKey(options);
  if (!publicKey || !secretKey) {
    throw new UploadcareFileValidationError(
      "Uploadcare file deletion is not configured.",
      503,
    );
  }

  const response = await (options.fetchFn ?? fetch)(
    `https://api.uploadcare.com/files/${encodeURIComponent(normalizedFileId)}/storage/`,
    {
      method: "DELETE",
      headers: {
        Accept: UPLOADCARE_REST_ACCEPT,
        Authorization: `Uploadcare.Simple ${publicKey}:${secretKey}`,
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return { fileId: normalizedFileId, alreadyDeleted: true };
  }
  if (!response.ok) {
    throw new UploadcareFileValidationError(
      "Uploadcare could not delete the uploaded file.",
      502,
    );
  }

  return { fileId: normalizedFileId, alreadyDeleted: false };
}

export async function validateUploadcareFiles(
  references: readonly string[],
  policy: UploadcareFilePolicy,
  options: {
    publicKey?: string;
    secretKey?: string;
    fetchFn?: typeof fetch;
  } = {},
) {
  const fileIds = references.map((reference) => extractUploadcareFileId(reference));
  if (fileIds.some((fileId) => !fileId)) {
    throw new UploadcareFileValidationError(`Invalid ${policy.label} upload reference.`);
  }

  const normalizedFileIds = fileIds.filter((fileId): fileId is string => Boolean(fileId));
  if (normalizedFileIds.length > policy.maxCount) {
    throw new UploadcareFileValidationError(
      `${policy.label} allows a maximum of ${policy.maxCount} file${policy.maxCount === 1 ? "" : "s"}.`,
    );
  }
  if (new Set(normalizedFileIds).size !== normalizedFileIds.length) {
    throw new UploadcareFileValidationError(`Duplicate ${policy.label} uploads are not allowed.`);
  }

  const metadata = await Promise.all(
    normalizedFileIds.map((fileId) => getUploadcareFileMetadata(fileId, options)),
  );
  for (const file of metadata) {
    if (file.isRemoved) {
      throw new UploadcareFileValidationError(`A ${policy.label} upload has been deleted.`);
    }
    if (!file.isReady) {
      throw new UploadcareFileValidationError(`A ${policy.label} upload is not ready yet.`);
    }
    if (!file.isStored) {
      throw new UploadcareFileValidationError(`A ${policy.label} upload is not stored permanently.`);
    }
    if (file.size > policy.maxBytes) {
      throw new UploadcareFileValidationError(
        `${policy.label} files must be ${Math.floor(policy.maxBytes / (1024 * 1024))} MB or smaller.`,
      );
    }
    if (policy.imagesOnly && (!file.isImage || !file.mimeType.startsWith("image/"))) {
      throw new UploadcareFileValidationError(`${policy.label} accepts image files only.`);
    }
    if (
      policy.allowedMimeTypes &&
      !policy.allowedMimeTypes.some((allowed) =>
        allowed.endsWith("/*")
          ? file.mimeType.startsWith(allowed.slice(0, -1))
          : file.mimeType === allowed,
      )
    ) {
      throw new UploadcareFileValidationError(
        `${policy.label} does not support the uploaded file type.`,
      );
    }
  }

  return metadata;
}

async function discoverUploadcareCdnBaseUrl(
  fileId: string,
  options: { publicKey?: string; fetchFn?: typeof fetch } = {},
) {
  if (cachedUploadcareCdnBaseUrl) return cachedUploadcareCdnBaseUrl;

  const configured = resolveConfiguredUploadcareBaseUrl();
  if (configured) {
    cachedUploadcareCdnBaseUrl = configured;
    return configured;
  }

  const publicKey = resolveUploadcarePublicKey(options);
  if (!publicKey) {
    throw new Error("Uploadcare public key is not configured.");
  }

  const fetchFn = options.fetchFn ?? fetch;
  const body = new FormData();
  body.set("pub_key", publicKey);
  body.append("files[]", fileId);
  const secretKey = resolveUploadcareSecretKey();
  if (secretKey) {
    const credentials = createUploadcareSignedUploadCredentials({ publicKey, secretKey });
    body.set("signature", credentials.secureSignature);
    body.set("expire", credentials.secureExpire);
  }

  const response = await fetchFn("https://upload.uploadcare.com/group/", {
    method: "POST",
    body,
  });
  const payload = (await response.json().catch(() => null)) as { cdn_url?: unknown } | null;
  const cdnUrl = typeof payload?.cdn_url === "string" ? payload.cdn_url : "";

  if (!response.ok || !cdnUrl) {
    throw new Error("Uploadcare CDN base could not be resolved.");
  }

  try {
    const parsed = new URL(cdnUrl);
    if (parsed.protocol === "https:" && isTrustedUploadcareHost(parsed.hostname)) {
      cachedUploadcareCdnBaseUrl = parsed.origin;
      return parsed.origin;
    }
  } catch {
    // fall through
  }

  throw new Error("Uploadcare CDN base could not be resolved.");
}

async function uploadBlobToUploadcareFileId(
  blob: Blob,
  options: { fileName?: string; publicKey?: string; secretKey?: string } = {},
) {
  const publicKey = resolveUploadcarePublicKey(options);
  const secretKey = resolveUploadcareSecretKey(options);
  if (!publicKey) {
    throw new Error("Uploadcare public key is not configured.");
  }

  const formData = new FormData();
  formData.set("UPLOADCARE_PUB_KEY", publicKey);
  formData.set("UPLOADCARE_STORE", "1");
  if (secretKey) {
    const credentials = createUploadcareSignedUploadCredentials({ publicKey, secretKey });
    formData.set("signature", credentials.secureSignature);
    formData.set("expire", credentials.secureExpire);
  }
  formData.set("file", blob, options.fileName?.trim() || "upload.bin");

  const response = await fetch("https://upload.uploadcare.com/base/", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => null)) as
    | { file?: unknown; error?: { content?: unknown } }
    | null;
  if (!response.ok || typeof payload?.file !== "string") {
    const providerMessage =
      typeof payload?.error?.content === "string"
        ? payload.error.content
        : "Upload failed";
    throw new Error(providerMessage);
  }

  const fileId = extractUploadcareFileId(payload.file);
  if (!fileId) {
    throw new Error("Upload returned an invalid file reference.");
  }

  return fileId;
}

export async function uploadDataUrlToUploadcareFileId(
  dataUrl: string,
  options: { fileName?: string; publicKey?: string; secretKey?: string } = {},
) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) {
    throw new Error("Invalid image payload.");
  }

  return uploadBlobToUploadcareFileId(new Blob([decoded.bytes], { type: decoded.mimeType }), {
    ...options,
    fileName: options.fileName?.trim() || "signature.png",
  });
}

function fileNameFromRemoteUrl(remoteUrl: string, fallback = "upload.bin") {
  try {
    const parsed = new URL(remoteUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (segment && segment.includes(".")) {
      return segment;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

export async function uploadRemoteFileUrlToUploadcareFileId(
  remoteUrl: string,
  options: {
    fileName?: string;
    publicKey?: string;
    secretKey?: string;
    fetchFn?: typeof fetch;
  } = {},
) {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(remoteUrl);
  if (!response.ok) {
    throw new Error(`Remote file fetch failed with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.trim() || "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  return uploadBlobToUploadcareFileId(new Blob([bytes], { type: contentType }), {
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    fileName: options.fileName?.trim() || fileNameFromRemoteUrl(remoteUrl),
  });
}

export async function resolveUploadcareCdnUrl(
  fileId: string,
  options: { publicKey?: string; fetchFn?: typeof fetch } = {},
) {
  const normalizedFileId = normalizeText(fileId);
  if (!UPLOADCARE_FILE_ID_RE.test(normalizedFileId)) {
    throw new Error("Invalid Uploadcare file id.");
  }
  const baseUrl = await discoverUploadcareCdnBaseUrl(normalizedFileId, options);
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(normalizedFileId)}/`;
}
