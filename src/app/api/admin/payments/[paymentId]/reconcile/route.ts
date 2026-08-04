import { NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { getStripeClient } from "@/lib/payments/stripe";
import { reconcileStripeCheckoutSession } from "@/lib/payments/stripeReconcile";
import { requireCsrf } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;
  if (!(await requireCsrf(request))) return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  const { paymentId } = await params;
  const result = await getDbPool().query("select provider_ref from payments where id = $1 and provider = 'STRIPE'", [paymentId]);
  const sessionId = result.rows[0]?.provider_ref;
  if (!sessionId) return NextResponse.json({ error: "Stripe Checkout Session not found" }, { status: 404 });
  try {
    const session = await getStripeClient().checkout.sessions.retrieve(sessionId);
    const reconciled = await reconcileStripeCheckoutSession(session, "admin");
    return NextResponse.json(reconciled);
  } catch { return NextResponse.json({ error: "Unable to reconcile Stripe Checkout Session" }, { status: 502 }); }
}
