import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { loadBookingVehicleInspectionSummaries } from "@/lib/bookings/vehicleInspection";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { finalizeDirectUploadSession } from "@/lib/uploads/directUploadSessions";
import { writeMediaAudit } from "@/lib/uploads/mediaAudit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId.trim() : "";
  if (!UUID_RE.test(uploadId)) return json({ ok: false, error: "Upload ID is invalid." }, 400);

  try {
    const finalized = await finalizeDirectUploadSession({ uploadId, userId: auth.actor.userId });
    if (!finalized) return json({ ok: false, error: "Upload session not found." }, 404);
    if (finalized.audit) {
      try {
        await writeMediaAudit({
          userId: auth.actor.userId,
          action: "MEDIA_UPLOAD",
          entityType: finalized.audit.entityType,
          entityId: finalized.audit.entityId,
          fileId: typeof finalized.result.storageKey === "string" ? finalized.result.storageKey : uploadId,
          context: finalized.audit.context,
          label: typeof finalized.result.originalFileName === "string" ? finalized.result.originalFileName : null,
          outcome: "Uploaded directly to Bunny Storage",
          details: { directUploadSessionId: uploadId, purpose: finalized.purpose },
        });
      } catch (auditError) {
        logError("api.admin.uploads.direct.finalize.audit", auditError, { uploadId });
      }
    }
    const inspections = finalized.purpose === "INSPECTION_IMAGE" && finalized.entityId
      ? await loadBookingVehicleInspectionSummaries(finalized.entityId)
      : undefined;
    return json({ ok: true, purpose: finalized.purpose, result: finalized.result, inspections });
  } catch (error) {
    logError("api.admin.uploads.direct.finalize", error, { uploadId, userId: auth.actor.userId });
    const message = error instanceof Error ? error.message : "Unable to finalize image upload.";
    return json({ ok: false, error: message }, message.includes("not finished") ? 409 : 400);
  }
}
