const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const RASTER_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

type RasterImageMimeType = (typeof RASTER_IMAGE_MIME_TYPES)[number];
type UploadFile = Pick<File, "slice" | "type">;

function hasBytes(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function detectedMimeType(bytes: Uint8Array): RasterImageMimeType | null {
  if (hasBytes(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (hasBytes(bytes, PNG_SIGNATURE)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  // HEIC/HEIF files use an ISO base-media `ftyp` box. The documented major
  // brands below cover the image formats this application accepts.
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12))) {
    return "image/heif";
  }
  return null;
}

export async function validateRasterImageFile(file: UploadFile) {
  const claimedType = file.type.trim().toLowerCase();
  if (!RASTER_IMAGE_MIME_TYPES.includes(claimedType as RasterImageMimeType)) {
    return "Choose a JPG, PNG, WebP, HEIC, or HEIF image.";
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detected = detectedMimeType(bytes);
  if (!detected) return "The image contents are not a recognized supported raster format.";

  const heifClaim = claimedType === "image/heic" || claimedType === "image/heif";
  const heifDetected = detected === "image/heif";
  if ((heifClaim && heifDetected) || claimedType === detected) return null;
  return "The image contents do not match the declared file type.";
}
