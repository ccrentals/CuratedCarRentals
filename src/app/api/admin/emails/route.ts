import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { fetchAdminEmailsPage } from "@/lib/notifications/adminEmails";
import { logError } from "@/lib/log";

export async function GET(request: Request) {
  const auth = await requireAdminAccess();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);

  try {
    const page = await fetchAdminEmailsPage({
      status: searchParams.get("status"),
      emailType: searchParams.get("emailType"),
      entityType: searchParams.get("entityType"),
      triggerSource: searchParams.get("triggerSource"),
      q: searchParams.get("q"),
      sortBy: searchParams.get("sortBy"),
      sortDir: searchParams.get("sortDir"),
      limit: searchParams.get("limit"),
      offset: searchParams.get("offset"),
      page: searchParams.get("page"),
      dateFrom: searchParams.get("dateFrom"),
      dateTo: searchParams.get("dateTo"),
    });

    return NextResponse.json({ ok: true, ...page });
  } catch (error) {
    logError("admin_emails_list_failed", error);
    return NextResponse.json({ ok: false, error: "Failed to load emails." }, { status: 500 });
  }
}
