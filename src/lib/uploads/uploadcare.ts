const UPLOADCARE_FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:~\d+)?$/i;
const TRUSTED_UPLOADCARE_HOSTS = ["ucarecdn.com", "ucarecd.net"] as const;
let cachedUploadcareCdnBaseUrl: string | null = null;

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
  options: { fileName?: string; publicKey?: string } = {},
) {
  const publicKey = resolveUploadcarePublicKey(options);
  if (!publicKey) {
    throw new Error("Uploadcare public key is not configured.");
  }

  const formData = new FormData();
  formData.set("UPLOADCARE_PUB_KEY", publicKey);
  formData.set("UPLOADCARE_STORE", "1");
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
  options: { fileName?: string; publicKey?: string } = {},
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
  options: { fileName?: string; publicKey?: string; fetchFn?: typeof fetch } = {},
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
