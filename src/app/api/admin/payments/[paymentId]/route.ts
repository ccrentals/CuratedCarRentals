import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { overrideOverlappingNonBlockingBookings } from "@/lib/bookings/holds";
import {
  getInternalNotesRecipient,
  sendBookingOverriddenByPaidBookingEmail,
} from "@/lib/notifications/email";

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

function parseRequireRestoreReason(content: unknown) {
  if (typeof content !== "string" || !content.trim()) return true;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.requireRestoreReason === "boolean") {
      return parsed.requireRestoreReason;
    }
    return true;
  } catch {
    return true;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { paymentId } = await params;
  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  if (!paymentId) {
    return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
  }

  if (action !== "delete" && action !== "restore") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (action === "delete" && !reason) {
    return NextResponse.json({ error: "Reason is required" }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    let requireRestoreReason = true;
    try {
      const settingsResult = await client.query(
        "select content from admin_documents where key = 'settings' limit 1",
      );
      requireRestoreReason = parseRequireRestoreReason(settingsResult.rows[0]?.content);
    } catch (settingsError) {
      const settingsCode = (settingsError as { code?: string } | null)?.code;
      if (settingsCode !== "42P01") {
        throw settingsError;
      }
    }

    if (action === "restore" && requireRestoreReason && !note) {
      return NextResponse.json({ error: "Reason is required" }, { status: 400 });
    }

    await client.query("begin");

    const paymentResult = await client.query(
      "select id, booking_id, provider, status, deposit_amount_cents, deleted_at from payments where id = $1 for update",
      [paymentId],
    );

    if (paymentResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const payment = paymentResult.rows[0] as {
      id: string;
      booking_id: string;
      provider: string;
      status: string;
      deposit_amount_cents: number;
      deleted_at: string | null;
    };

    const bookingStatusResult = await client.query(
      "select id, status from bookings where id = $1 for update",
      [payment.booking_id],
    );

    if (bookingStatusResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const bookingStatusBefore = String(bookingStatusResult.rows[0].status ?? "").toUpperCase();

    if (payment.provider !== "MANUAL") {
      await client.query("rollback");
      return NextResponse.json({ error: "Only MANUAL payments can be modified" }, { status: 400 });
    }

    if (action === "delete") {
      await client.query(
        "update payments set deleted_at = now(), deleted_by_user_id = $2, deleted_reason = $3, updated_at = now() where id = $1 and deleted_at is null",
        [paymentId, session.userId, reason],
      );
    }

    if (action === "restore") {
      await client.query(
        "update payments set deleted_at = null, deleted_by_user_id = null, deleted_reason = null, updated_at = now() where id = $1 and deleted_at is not null",
        [paymentId],
      );
    }

    const summary = await recalculateBookingPayments(payment.booking_id, { client });
    let bookingStatusTransition: { from: string; to: string } | null = null;

    if (
      bookingStatusBefore === "PICKED_UP" &&
      (summary.paymentStatus !== "PAID_IN_FULL" || summary.balanceDue > 0)
    ) {
      const nextStatus = summary.paymentStatus === "UNPAID" ? "PENDING_PAYMENT" : "CONFIRMED";
      await client.query("update bookings set status = $2, updated_at = now() where id = $1", [
        payment.booking_id,
        nextStatus,
      ]);
      bookingStatusTransition = {
        from: bookingStatusBefore,
        to: nextStatus,
      };
    }

    let overriddenBookings: Array<{
      id: string;
      customerName: string;
      customerEmail: string;
      vehicleLabel: string;
      startDate: string;
      endDate: string;
      pickupLocation: string;
    }> = [];

    if (action === "restore" && summary.netPaidToDate > 0) {
      const bookingResult = await client.query(
        "select b.id, b.vehicle_id, b.start_date, b.end_date from bookings b where b.id = $1 for update",
        [payment.booking_id],
      );

      if (bookingResult.rowCount > 0) {
        const booking = bookingResult.rows[0] as {
          id: string;
          vehicle_id: string;
          start_date: string;
          end_date: string;
        };

        const overrideOutcome = await overrideOverlappingNonBlockingBookings(client, {
          paidBookingId: booking.id,
          vehicleId: booking.vehicle_id,
          startDate: booking.start_date,
          endDate: booking.end_date,
          overrideReason: "Overridden by paid booking",
        });

        if (overrideOutcome.blockingConflictIds.length > 0) {
          await client.query("rollback");
          return NextResponse.json(
            { error: "Vehicle is no longer available for these dates" },
            { status: 409 },
          );
        }

        overriddenBookings = overrideOutcome.overridden;
      }
    }

    await client.query("commit");

    await writeAuditLog({
      userId: session.userId,
      action: action === "delete" ? "MANUAL_PAYMENT_DELETED" : "MANUAL_PAYMENT_RESTORED",
      entityType: "payment",
      entityId: payment.id,
      details: {
        bookingId: payment.booking_id,
        amount: payment.deposit_amount_cents,
        status: payment.status,
        reason: action === "delete" ? reason : undefined,
        note: action === "restore" ? note || undefined : undefined,
        overriddenBookings: overriddenBookings.map((item) => item.id),
        bookingStatusTransition,
      },
    });

    if (bookingStatusTransition) {
      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_STATUS_AUTO_REVERTED",
        entityType: "booking",
        entityId: payment.booking_id,
        details: {
          trigger: action === "delete" ? "manual_payment_cancelled" : "manual_payment_restored",
          from: bookingStatusTransition.from,
          to: bookingStatusTransition.to,
          paymentStatus: summary.paymentStatus,
          netPaidToDate: summary.netPaidToDate,
          balanceDue: summary.balanceDue,
        },
      });
    }

    for (const overriddenBooking of overriddenBookings) {
      await writeAuditLog({
        userId: session.userId,
        action: "BOOKING_OVERRIDDEN_BY_PAID_BOOKING",
        entityType: "booking",
        entityId: overriddenBooking.id,
        details: {
          overriddenByBookingId: payment.booking_id,
          overrideReason: "Overridden by paid booking",
        },
      });

      await sendBookingOverriddenByPaidBookingEmail({
        recipientType: "customer",
        recipientEmail: overriddenBooking.customerEmail,
        bookingId: overriddenBooking.id,
        customerName: overriddenBooking.customerName,
        customerEmail: overriddenBooking.customerEmail,
        vehicleLabel: overriddenBooking.vehicleLabel,
        startDate: overriddenBooking.startDate,
        endDate: overriddenBooking.endDate,
        pickupLocation: overriddenBooking.pickupLocation,
        overriddenByBookingId: payment.booking_id,
      });

      await sendBookingOverriddenByPaidBookingEmail({
        recipientType: "internal",
        recipientEmail: getInternalNotesRecipient(),
        bookingId: overriddenBooking.id,
        customerName: overriddenBooking.customerName,
        customerEmail: overriddenBooking.customerEmail,
        vehicleLabel: overriddenBooking.vehicleLabel,
        startDate: overriddenBooking.startDate,
        endDate: overriddenBooking.endDate,
        pickupLocation: overriddenBooking.pickupLocation,
        overriddenByBookingId: payment.booking_id,
      });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    await client.query("rollback");
    const code = (error as { code?: string } | null)?.code;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
      return NextResponse.json(
        {
          error: "PAYMENTS_SOFT_DELETE_NOT_CONFIGURED",
          message: "payments.deleted_* columns are missing. Apply schema.sql changes and redeploy.",
        },
        { status: 500 },
      );
    }
    logError("api.admin.payments.PATCH", error, { userId: session.userId, paymentId, action });
    return NextResponse.json({ error: "Failed to update payment" }, { status: 500 });
  } finally {
    client.release();
  }
}
