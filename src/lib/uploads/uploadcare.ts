const UPLOADCARE_FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:~\d+)?$/i;

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function extractUploadcareFileId(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (UPLOADCARE_FILE_ID_RE.test(normalized)) return normalized;

  const match = normalized.match(
    /(?:https?:\/\/)?(?:www\.)?ucarecdn\.com\/([0-9a-f-]{36}(?:~\d+)?)\/?/i,
  );
  if (match?.[1] && UPLOADCARE_FILE_ID_RE.test(match[1])) {
    return match[1];
  }

  return null;
}

export function buildUploadcareCdnUrl(fileId: string) {
  return `https://ucarecdn.com/${encodeURIComponent(fileId)}/`;
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

export async function uploadDataUrlToUploadcareFileId(
  dataUrl: string,
  options: { fileName?: string; publicKey?: string } = {},
) {
  const publicKey =
    options.publicKey?.trim() || process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY?.trim() || "";
  if (!publicKey) {
    throw new Error("Uploadcare public key is not configured.");
  }

  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) {
    throw new Error("Invalid image payload.");
  }

  const formData = new FormData();
  formData.set("UPLOADCARE_PUB_KEY", publicKey);
  formData.set("UPLOADCARE_STORE", "1");
  formData.set(
    "file",
    new Blob([decoded.bytes], { type: decoded.mimeType }),
    options.fileName?.trim() || "signature.png",
  );

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
