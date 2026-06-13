import {
  MAX_BOOKING_PRIVATE_IMAGE_BYTES,
  resolveSafePrivateBookingResponseMimeType,
  sanitizePrivateBookingFileName,
} from "@/lib/bookings/privateFiles";
import {
  UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES,
  type UploadcareFilePolicy,
} from "@/lib/uploads/uploadcare";

export const CUSTOMER_PRIVATE_FILE_DOCUMENT_TYPE = "DRIVERS_LICENSE";
export const MAX_CUSTOMER_ID_IMAGES_PER_UPLOAD = 20;

export const CUSTOMER_ID_IMAGE_POLICY: UploadcareFilePolicy = {
  label: "customer ID image",
  maxCount: MAX_CUSTOMER_ID_IMAGES_PER_UPLOAD,
  maxBytes: MAX_BOOKING_PRIVATE_IMAGE_BYTES,
  imagesOnly: true,
  allowedMimeTypes: UPLOADCARE_ALLOWED_RASTER_IMAGE_MIME_TYPES,
};

export type CustomerPrivateFileRow = {
  id: string;
  customer_id: string;
  booking_id: string | null;
  booking_public_id: string | null;
  document_type: string;
  storage_provider: string;
  storage_key: string;
  original_file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  metadata_json: Record<string, unknown> | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type CustomerPrivateFileItem = {
  id: string;
  customerId: string;
  bookingId: string | null;
  bookingPublicId: string | null;
  documentType: string;
  originalFileName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  source: string;
  createdAt: string;
  openUrl: string;
};

export function customerPrivateFileName(row: {
  document_type: string;
  original_file_name: string | null;
  mime_type: string | null;
}) {
  return sanitizePrivateBookingFileName(
    row.document_type,
    row.original_file_name,
    row.mime_type || "image/jpeg",
  );
}

export function resolveCustomerPrivateFileMimeType(
  storedMimeType: unknown,
  actualMimeType?: unknown,
) {
  return resolveSafePrivateBookingResponseMimeType(storedMimeType, actualMimeType);
}
