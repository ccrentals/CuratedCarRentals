import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;

  const bookingResult = await dbQuery<{ status: string }>(
    "select status from bookings where id = $1",
    [id],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const status = bookingResult.rows[0].status;
  if (status === "RETURNED") {
    return NextResponse.json({ error: "Returned bookings cannot be cancelled" }, { status: 400 });
  }

  if (status === "CANCELLED") {
    return NextResponse.json({ ok: true, message: "Already cancelled" });
  }

  await dbQuery("update bookings set status = 'CANCELLED', updated_at = now() where id = $1", [id]);

  await writeAuditLog({
    userId: actor.userId,
    action: "BOOKING_CANCELLED",
    entityType: "booking",
    entityId: id,
    details: { previous_status: status },
  });

  return NextResponse.json({ ok: true });
}
