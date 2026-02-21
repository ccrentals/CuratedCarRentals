import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { buildUploadcareCdnUrl, extractUploadcareFileId } from "@/lib/uploads/uploadcare";

type BookingFileRow = {
  id: string;
  booking_id: string;
  document_type: string;
  storage_provider: string;
  storage_key: string;
  original_file_name: string | null;
  mime_type: string | null;
};

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentType: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }

  const { id: bookingId, documentType: documentTypeRaw } = await params;
  const documentType = normalizeDocumentType(documentTypeRaw);
  if (!documentType) {
    return jsonNoStore({ error: "Invalid document type." }, 400);
  }

  try {
    const fileResult = await dbQuery<BookingFileRow>(
      "select id, booking_id, document_type, storage_provider, storage_key, original_file_name, mime_type from booking_private_files where booking_id = $1 and document_type = $2 order by created_at desc limit 1",
      [bookingId, documentType],
    );

    const file = fileResult.rows[0] ?? null;
    if (!file) {
      return jsonNoStore({ error: "File not found." }, 404);
    }

    const isDataUrl = file.storage_provider.toUpperCase() === "DATA_URL";
    if (isDataUrl) {
      const decoded = decodeDataUrl(file.storage_key);
      if (!decoded) {
        return jsonNoStore({ error: "Unable to read file data." }, 500);
      }

      return new NextResponse(decoded.bytes, {
        status: 200,
        headers: {
          "content-type": file.mime_type || decoded.mimeType,
          "cache-control": "private, max-age=0, no-store",
          "content-disposition": `inline; filename="${file.original_file_name || `${documentType.toLowerCase()}.png`}"`,
        },
      });
    }

    const normalizedProvider = file.storage_provider.trim().toUpperCase();
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

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type":
          file.mime_type || upstream.headers.get("content-type") || "application/octet-stream",
        "cache-control": "private, max-age=0, no-store",
        "content-disposition": `inline; filename="${file.original_file_name || `${documentType.toLowerCase()}.jpg`}"`,
      },
    });
  } catch (error) {
    logError("admin.bookings.private-files.GET", error, {
      bookingId,
      documentType,
      userId: session.userId,
    });
    return jsonNoStore({ error: "Failed to load booking file." }, 500);
  }
}
