import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { hasRequiredAdminAccess } from "@/lib/auth/roles";
import { getFileStorageProvider } from "@/lib/env";
import { requireCsrf } from "@/lib/security/csrf";
import {
  evaluateDirectImageEligibility,
  isDirectImageMimeType,
  normalizeSha256,
  type DirectImageUploadPurpose,
} from "@/lib/uploads/directUpload";
import {
  createDirectUploadSession,
  getDirectUploadGatewayUrl,
  resolveDirectUploadDestination,
} from "@/lib/uploads/directUploadSessions";

const PURPOSES = new Set<DirectImageUploadPurpose>([
  "VEHICLE_GALLERY",
  "LANDING_CONTENT",
  "CUSTOMER_LEGAL_ID",
  "INSPECTION_IMAGE",
]);

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!(await requireCsrf(request, typeof body?.csrfToken === "string" ? body.csrfToken : null))) {
    return json({ ok: false, error: "Invalid CSRF token." }, 403);
  }
  if (getFileStorageProvider() !== "bunny") {
    return json({ ok: false, error: "Direct Bunny uploads are not active." }, 409);
  }
  const purpose = typeof body?.purpose === "string" ? body.purpose.toUpperCase() : "";
  if (!PURPOSES.has(purpose as DirectImageUploadPurpose)) {
    return json({ ok: false, error: "Image upload purpose is invalid." }, 400);
  }
  if (purpose === "LANDING_CONTENT" && !hasRequiredAdminAccess(auth.actor.role, "admin")) {
    return json({ ok: false, error: "Administrator access is required for landing content." }, 403);
  }
  const fileName = typeof body?.fileName === "string" ? body.fileName.trim().slice(0, 255) : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const size = typeof body?.size === "number" ? body.size : Number.NaN;
  const eligibility = evaluateDirectImageEligibility({ size, mimeType });
  if (!fileName || !eligibility.eligible || !isDirectImageMimeType(mimeType)) {
    return json({ ok: false, error: fileName ? eligibility.message : "Image filename is required." }, 400);
  }
  const rawChecksum = body?.checksum;
  const checksum = rawChecksum == null || rawChecksum === "" ? null : normalizeSha256(rawChecksum);
  if (rawChecksum && !checksum) return json({ ok: false, error: "Image checksum is invalid." }, 400);
  const context = body?.context && typeof body.context === "object" && !Array.isArray(body.context)
    ? (body.context as Record<string, unknown>)
    : {};
  try {
    const uploadUrl = getDirectUploadGatewayUrl();
    const destination = await resolveDirectUploadDestination({
      purpose: purpose as DirectImageUploadPurpose,
      entityId: body?.entityId,
      fileName,
      context,
    });
    const session = await createDirectUploadSession({
      userId: auth.actor.userId,
      purpose: purpose as DirectImageUploadPurpose,
      destination,
      fileName,
      mimeType,
      size,
      checksum,
    });
    return json({
      ok: true,
      uploadId: session.id,
      uploadToken: session.token,
      uploadUrl,
      expiresAt: session.expiresAt.toISOString(),
      maxBytes: 50 * 1024 * 1024,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to authorize image upload.";
    return json({ ok: false, error: message }, message.includes("not configured") ? 503 : 400);
  }
}
