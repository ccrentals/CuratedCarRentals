import { extractUploadcareFileId } from "@/lib/uploads/uploadcare";

export type VehicleGalleryEntry = {
  name: string;
  uploadcareFileId: string | null;
  url: string;
  position: number;
};

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function galleryName(vehiclePublicId: string, slug: string, index: number) {
  return `${vehiclePublicId}-${slug}-gallery-${String(index).padStart(2, "0")}`;
}

function parseExistingGallery(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = toObject(entry);
      const url = toStringValue(row.url);
      if (!url) return null;
      return {
        name: toStringValue(row.name),
        uploadcareFileId: toStringValue(row.uploadcareFileId),
        url,
      };
    })
    .filter((entry): entry is { name: string; uploadcareFileId: string; url: string } => entry !== null);
}

export function buildVehicleGalleryEntries(input: {
  imageUrls: string[];
  vehiclePublicId: string;
  slug: string;
  existingGallery?: unknown;
}) {
  const existing = parseExistingGallery(input.existingGallery);
  const byUrl = new Map(existing.map((entry) => [entry.url, entry]));
  const byFileId = new Map(
    existing
      .filter((entry) => entry.uploadcareFileId)
      .map((entry) => [entry.uploadcareFileId, entry] as const),
  );

  return input.imageUrls.map((url, zeroIndex) => {
    const position = zeroIndex + 1;
    const uploadcareFileId = extractUploadcareFileId(url);
    const existingEntry = byUrl.get(url) ?? (uploadcareFileId ? byFileId.get(uploadcareFileId) : undefined);
    return {
      name: existingEntry?.name || galleryName(input.vehiclePublicId, input.slug, position),
      uploadcareFileId,
      url,
      position,
    } satisfies VehicleGalleryEntry;
  });
}
