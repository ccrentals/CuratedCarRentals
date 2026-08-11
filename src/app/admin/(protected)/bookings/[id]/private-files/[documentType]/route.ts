import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import {
  parseSafePrivateBookingImageDataUrl,
  resolveSafePrivateBookingResponseMimeType,
  sanitizePrivateBookingFileName,
} from "@/lib/bookings/privateFiles";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { buildUploadcareCdnUrl, extractUploadcareFileId } from "@/lib/uploads/uploadcare";
import { fetchBunnyStorageObject, getBunnyStorageConfig, normalizeBunnyStorageKey } from "@/lib/uploads/bunny";

type BookingFileRow = {
  id: string;
  booking_id: string;
  document_type: string;
  storage_provider: string;
  storage_key: string;
  original_file_name: string | null;
  mime_type: string | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeDocumentType(value: string) {
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  if (normalized === "DRIVERS_LICENSE") return "DRIVERS_LICENSE";
  if (normalized === "SIGNATURE") return "SIGNATURE";
  return null;
}

function jsonNoStore(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentType: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) {
    return auth.response;
  }
  const actor = auth.actor;

  const { id: bookingId, documentType: documentTypeRaw } = await params;
  const documentType = normalizeDocumentType(documentTypeRaw);
  if (!documentType) {
    return jsonNoStore({ error: "Invalid document type." }, 400);
  }
  const fileId = new URL(request.url).searchParams.get("fileId")?.trim() ?? "";
  if (fileId && !UUID_REGEX.test(fileId)) {
    return jsonNoStore({ error: "Invalid file ID." }, 400);
  }

  try {
    const fileResult = await dbQuery<BookingFileRow>(
      "select id, booking_id, document_type, storage_provider, storage_key, original_file_name, mime_type from booking_private_files where booking_id = $1 and document_type = $2 and ($3::uuid is null or id = $3::uuid) order by created_at desc limit 1",
      [bookingId, documentType, fileId || null],
    );

    const file = fileResult.rows[0] ?? null;
    if (!file) {
      return jsonNoStore({ error: "File not found." }, 404);
    }

    const isDataUrl = file.storage_provider.toUpperCase() === "DATA_URL";
    if (isDataUrl) {
      const parsed = parseSafePrivateBookingImageDataUrl(file.storage_key);
      if (!parsed) {
        return jsonNoStore({ error: "Unable to load a safe file from storage." }, 500);
      }

      return new NextResponse(parsed.bytes, {
        status: 200,
        headers: {
          "content-type": parsed.mimeType,
          "cache-control": "private, max-age=0, no-store",
          "content-disposition": `inline; filename="${sanitizePrivateBookingFileName(
            documentType,
            file.original_file_name,
            parsed.mimeType,
          )}"`,
          "x-content-type-options": "nosniff",
        },
      });
    }

    const normalizedProvider = file.storage_provider.trim().toUpperCase();
    if (normalizedProvider === "BUNNY_STORAGE") {
      let storageKey: string;
      try {
        storageKey = normalizeBunnyStorageKey(file.storage_key);
      } catch {
        return jsonNoStore({ error: "Unsupported storage reference." }, 500);
      }
      if (!storageKey.startsWith("private/bookings/")) {
        return jsonNoStore({ error: "Unsupported storage reference." }, 500);
      }
      const upstream = await fetchBunnyStorageObject(getBunnyStorageConfig("private"), storageKey);
      const safeMimeType = resolveSafePrivateBookingResponseMimeType(file.mime_type, upstream.headers.get("content-type"));
      if (!safeMimeType) return jsonNoStore({ error: "Unable to load a safe file from storage." }, 502);
      return new NextResponse(upstream.body, {
        status: 200,
        headers: {
          "content-type": safeMimeType,
          "cache-control": "private, max-age=0, no-store",
          "content-disposition": `inline; filename="${sanitizePrivateBookingFileName(documentType, file.original_file_name, safeMimeType)}"`,
          "x-content-type-options": "nosniff",
        },
      });
    }
    const uploadcareFileId = extractUploadcareFileId(file.storage_key);
    if (!uploadcareFileId) {
      return jsonNoStore({ error: "Unsupported storage reference." }, 500);
    }

    if (
      normalizedProvider &&
      !["UPLOADCARE", "UPLOADCARE_FILE_ID", "UPLOADCARE_TOKEN"].includes(normalizedProvider)
    ) {
      return jsonNoStore({ error: "Unsupported storage provider." }, 500);
    }

    const upstream = await fetch(buildUploadcareCdnUrl(uploadcareFileId));
    if (!upstream.ok || !upstream.body) {
      return jsonNoStore({ error: "Unable to load file from storage." }, 502);
    }
    const safeMimeType = resolveSafePrivateBookingResponseMimeType(
      file.mime_type,
      upstream.headers.get("content-type"),
    );
    if (!safeMimeType) {
      return jsonNoStore({ error: "Unable to load a safe file from storage." }, 502);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": safeMimeType,
        "cache-control": "private, max-age=0, no-store",
        "content-disposition": `inline; filename="${sanitizePrivateBookingFileName(
          documentType,
          file.original_file_name,
          safeMimeType,
        )}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logError("admin.bookings.private-files.GET", error, {
      bookingId,
      documentType,
      fileId: fileId || null,
      userId: actor.userId,
    });
    return jsonNoStore({ error: "Failed to load booking file." }, 500);
  }
}
