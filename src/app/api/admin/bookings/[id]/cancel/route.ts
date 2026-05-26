import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { writeAuditLog } from "@/lib/audit";
import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { syncPromoRedemptionStateForBooking } from "@/lib/promos";
import { requireCsrf } from "@/lib/security/csrf";
import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";

const ADMIN_BOOKING_CANCEL_LIMIT = 10;
const ADMIN_BOOKING_CANCEL_WINDOW_SECONDS = 10 * 60;

type AdminBookingCancelRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminBookingCancelRouteDeps = {
  requireAdminAccess: typeof requireOperationsAccess;
  requireCsrfCheck: typeof requireCsrf;
  consumeRateLimitCheck: typeof consumeRouteRateLimit;
  getPool: typeof getDbPool;
  syncPromoRedemption: typeof syncPromoRedemptionStateForBooking;
  writeAudit: typeof writeAuditLog;
  log: typeof logError;
};

const DEFAULT_DEPS: AdminBookingCancelRouteDeps = {
  requireAdminAccess: requireOperationsAccess,
  requireCsrfCheck: requireCsrf,
  consumeRateLimitCheck: consumeRouteRateLimit,
  getPool: getDbPool,
  syncPromoRedemption: syncPromoRedemptionStateForBooking,
  writeAudit: writeAuditLog,
  log: logError,
};

export async function handleAdminBookingCancelPost(
  request: Request,
  { params }: AdminBookingCancelRouteContext,
  deps: AdminBookingCancelRouteDeps = DEFAULT_DEPS,
) {
  const auth = await deps.requireAdminAccess();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await deps.requireCsrfCheck(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await params;
  const rateLimit = await deps.consumeRateLimitCheck({
    scope: "ADMIN_BOOKING_MUTATION_USER",
    route: "/api/admin/bookings/[id]/cancel",
    limit: ADMIN_BOOKING_CANCEL_LIMIT,
    windowSeconds: ADMIN_BOOKING_CANCEL_WINDOW_SECONDS,
    keyParts: [actor.userId, id],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Too many booking cancellation attempts. Please try again later." }, { status: 429 }),
      rateLimit,
    );
  }

  const pool = deps.getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = await client.query(
      "select status, pricing_json from bookings where id = $1 for update",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const bookingRow = bookingResult.rows[0] as { status: string; pricing_json: Record<string, unknown> | null };
    const status = bookingRow.status;
    const pricing = bookingRow.pricing_json ?? {};
    if (status === "RETURNED") {
      await client.query("rollback");
      return NextResponse.json({ error: "Returned bookings cannot be cancelled" }, { status: 400 });
    }

    if (status === "CANCELLED") {
      await client.query("commit");
      return NextResponse.json({ ok: true, message: "Already cancelled" });
    }

    const cancelledAt = new Date().toISOString();
    await client.query("update bookings set status = 'CANCELLED', pricing_json = $2, updated_at = now() where id = $1", [
      id,
      {
        ...pricing,
        cancelled_at: cancelledAt,
      },
    ]);
    await deps.syncPromoRedemption(id, {
      client,
      source: "admin_booking_cancel",
    });

    await client.query("commit");

    await deps.writeAudit({
      userId: actor.userId,
      action: "BOOKING_CANCELLED",
      entityType: "booking",
      entityId: id,
      details: { previous_status: status, cancelled_at: cancelledAt },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    deps.log("api.admin.bookings.cancel.POST", error, { bookingId: id, userId: actor.userId });
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: Request, context: AdminBookingCancelRouteContext) {
  return handleAdminBookingCancelPost(request, context, DEFAULT_DEPS);
}
