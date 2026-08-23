import { NextResponse } from "next/server";

import { normalizeSha256 } from "@/lib/uploads/directUpload";
import { recordDirectUploadGatewayResult, requireGatewaySecret } from "@/lib/uploads/directUploadSessions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!requireGatewaySecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
  const ok = body?.ok === true;
  const receivedBytes = typeof body?.receivedBytes === "number" ? body.receivedBytes : undefined;
const checksum = body?.checksum ? normalizeSha256(body.checksum) : null;
  if (
    !UUID_RE.test(uploadId) ||
    (body?.checksum != null && body.checksum !== "" && !checksum) ||
    (ok && (!Number.isSafeInteger(receivedBytes) || (receivedBytes ?? 0) <= 0))
  ) {
    return NextResponse.json({ ok: false, error: "Gateway result is invalid." }, { status: 400 });
  }
  const updated = await recordDirectUploadGatewayResult({
    uploadId,
    ok,
    receivedBytes,
    checksum,
    failureReason: typeof body?.failureReason === "string" ? body.failureReason : undefined,
  });
  if (!updated) return NextResponse.json({ ok: false, error: "Upload session is not active." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
