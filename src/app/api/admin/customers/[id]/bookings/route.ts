import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { fetchCustomerSnapshotBookingsPage } from "@/lib/customers/customerSnapshotBookings";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

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
