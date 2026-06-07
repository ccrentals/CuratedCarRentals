export type UploadcareSignedOptions = {
  publicKey: string;
  secureSignature: string;
  secureExpire: string;
};

export function getUploadcareClientErrorMessage(
  error: unknown,
  fallback = "Upload failed. Please try again.",
) {
  const message =
    error instanceof Error
      ? error.message.trim()
      : error && typeof error === "object" && "message" in error
        ? String(error.message ?? "").trim()
        : "";
  if (!message) return fallback;

  const normalized = message.toLowerCase();
  if (normalized.includes("cancel")) return "Upload cancelled.";
  if (
    normalized.includes("authorize") ||
    normalized.includes("signed uploads are not configured")
  ) {
    return "Upload service authorization failed. Refresh the page and try again.";
  }
  if (normalized.includes("not found in this uploadcare project")) {
    return "The uploaded file could not be verified in this Uploadcare project. Upload it again.";
  }
  if (normalized.includes("not stored permanently")) {
    return "The uploaded file was not stored permanently. Upload it again.";
  }
  if (normalized.includes("not ready")) {
    return "The uploaded file is still processing. Wait a moment and try again.";
  }
  if (normalized.includes("10 mb") || normalized.includes("too large")) {
    return "The file is too large. Choose a file no larger than 10 MB.";
  }
  if (normalized.includes("does not support") || normalized.includes("image files only")) {
    return "This file type is not supported. Choose a JPG, PNG, WebP, HEIC, or HEIF image.";
  }

  return message;
}

export async function getUploadcareSignedOptions(): Promise<UploadcareSignedOptions> {
  const response = await fetch("/api/admin/uploads/uploadcare/signature", {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<UploadcareSignedOptions> & { error?: string })
    | null;

  if (
    !response.ok ||
    !payload?.publicKey ||
    !payload.secureSignature ||
    !payload.secureExpire
  ) {
    throw new Error(payload?.error ?? "Unable to authorize the upload.");
  }

  return {
    publicKey: payload.publicKey,
    secureSignature: payload.secureSignature,
    secureExpire: payload.secureExpire,
  };
}
