export const MAX_DIRECT_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_DIRECT_IMAGES_PER_SELECTION = 20;

export const DIRECT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type DirectImageMimeType = (typeof DIRECT_IMAGE_MIME_TYPES)[number];
export type DirectImageUploadPurpose =
  | "VEHICLE_GALLERY"
  | "LANDING_CONTENT"
  | "CUSTOMER_LEGAL_ID"
  | "INSPECTION_IMAGE";
export type DirectImageUploadScope = "public" | "private";
export type DirectImageUploadStatus =
  | "AUTHORIZED"
  | "UPLOADING"
  | "UPLOADED"
  | "FINALIZED"
  | "FAILED"
  | "CLEANUP_PENDING"
  | "EXPIRED";

export type DirectImageEligibility =
  | { eligible: true; message: "Ready for direct upload." }
  | { eligible: false; message: string };

export function isDirectImageMimeType(value: unknown): value is DirectImageMimeType {
  return (
    typeof value === "string" &&
    DIRECT_IMAGE_MIME_TYPES.includes(value.trim().toLowerCase() as DirectImageMimeType)
  );
}
export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

export function evaluateDirectImageEligibility(input: {
  size: number;
  mimeType: string;
  maxBytes?: number;
}): DirectImageEligibility {
  const maxBytes = input.maxBytes ?? MAX_DIRECT_IMAGE_BYTES;
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    return { eligible: false, message: "The image is empty or its size is unavailable." };
  }
  if (input.size > maxBytes) {
    return { eligible: false, message: `This image exceeds the ${formatBytes(maxBytes)} upload limit.` };
  }
  if (!isDirectImageMimeType(input.mimeType)) {
    return { eligible: false, message: "Choose a JPG, PNG, WebP, HEIC, or HEIF image." };
  }
  return { eligible: true, message: "Ready for direct upload." };
}

export function uploadScopeForPurpose(purpose: DirectImageUploadPurpose): DirectImageUploadScope {
  return purpose === "VEHICLE_GALLERY" || purpose === "LANDING_CONTENT" ? "public" : "private";
}
