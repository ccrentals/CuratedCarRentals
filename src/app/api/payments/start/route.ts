import { requireCsrf } from "@/lib/security/csrf";
import { startPublicWipayPayment } from "@/lib/payments/publicPaymentStart";

const modes = new Set(["deposit", "full", "custom", "balance"]);

export async function POST(request: Request) {
  if (!(await requireCsrf(request))) return Response.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  const mode = typeof body?.mode === "string" ? body.mode.toLowerCase() : "";
  if (!bookingId || !modes.has(mode)) return Response.json({ ok: false, error: "Invalid payment request" }, { status: 400 });
  const customAmountCents = Number.isFinite(Number(body?.customAmountCents)) ? Math.round(Number(body.customAmountCents)) : null;
  return startPublicWipayPayment({ request, bookingId, mode: mode as "deposit" | "full" | "custom" | "balance", customAmountCents });
}
