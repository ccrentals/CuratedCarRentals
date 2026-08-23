import { NextResponse } from "next/server";

import { claimDirectUploadToken, requireGatewaySecret } from "@/lib/uploads/directUploadSessions";

export async function POST(request: Request) {
  if (!requireGatewaySecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 200) {
    return NextResponse.json({ ok: false, error: "Upload token is required." }, { status: 400 });
  }
  const session = await claimDirectUploadToken(token);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Upload token is expired or already used." }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    uploadId: session.id,
    scope: session.storage_scope,
    storageKey: session.storage_key,
    expectedBytes: Number(session.expected_bytes),
    mimeType: session.mime_type,
    checksum: session.checksum_sha256,
  });
}
