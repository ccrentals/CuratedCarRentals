import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { fetchCustomerSnapshotBookingsPage } from "@/lib/customers/customerSnapshotBookings";

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const page = await fetchCustomerSnapshotBookingsPage({
    customerId: id,
    status: searchParams.get("status"),
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    limit: searchParams.get("limit"),
    cursor: searchParams.get("cursor"),
  });

  return NextResponse.json(page);
}
