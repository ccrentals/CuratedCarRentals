import { requireCsrf } from "@/lib/security/csrf";
import { startPublicWipayPayment } from "@/lib/payments/publicPaymentStart";
import { hasPublicBookingBearerCredential } from "@/lib/bookings/publicAccess";

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

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
    mode: "custom",
    forceProvider: "WIPAY",
    customAmountCents: parseAmount(body?.customAmountCents ?? body?.amountCents),
  });
}
