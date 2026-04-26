import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { fetchAdminEmailDetail } from "@/lib/notifications/adminEmails";
import { logError } from "@/lib/log";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const detail = await fetchAdminEmailDetail(id);
    if (!detail) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item: detail });
  } catch (error) {
    logError("admin_email_detail_failed", error);
    return NextResponse.json({ ok: false, error: "Failed to load email detail." }, { status: 500 });
  }
}
