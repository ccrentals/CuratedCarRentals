import { requireCsrf } from "@/lib/security/csrf";
import { startPublicWipayPayment } from "@/lib/payments/publicPaymentStart";
import { hasPublicBookingBearerCredential } from "@/lib/bookings/publicAccess";

export async function POST(request: Request) {
  if (!hasPublicBookingBearerCredential(request) && !(await requireCsrf(request))) {
    return Response.json(
      { ok: false, code: "invalid_csrf", error: "Invalid CSRF token" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  if (!bookingId) {
    return Response.json(
      { ok: false, code: "invalid_request", error: "bookingId is required" },
      { status: 400 },
    );
  }

  return startPublicWipayPayment({
    request,
    bookingId,
    mode: "deposit",
    forceProvider: "WIPAY",
  });
}
