import type Stripe from "stripe";
import { getStripeClient } from "@/lib/payments/stripe";
import type { Queryable } from "@/lib/payments/pricing";

export class ItineraryPaymentPending extends Error {
  constructor(message: string, readonly completedSession?: Stripe.Checkout.Session) {
    super(message);
  }
}

// Caller holds the booking lock, which also serializes Checkout creation/reconciliation.
export async function retireItineraryCheckout(
  client: Queryable,
  bookingId: string,
  requestUrl?: string,
  stripe = getStripeClient,
) {
  const attempts = await client.query(
    "select id, provider_ref, metadata_json from payments where booking_id = $1 and provider = 'STRIPE' and status = 'INITIATED' for update",
    [bookingId],
  );
  for (const attempt of attempts.rows as { id: string; provider_ref: string | null; metadata_json: Record<string, unknown> | null }[]) {
    const sessionId = String(attempt.metadata_json?.checkout_session_id ?? attempt.provider_ref ?? "");
    if (!sessionId.startsWith("cs_")) {
      throw new ItineraryPaymentPending("A Checkout attempt is still starting. Wait for it to resolve before changing the booking.");
    }
    try {
      const api = stripe(requestUrl);
      let session = await api.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        throw new ItineraryPaymentPending("A completed payment needs reconciliation. Refresh the preview and review the updated balance.", session);
      }
      if (session.status === "open") session = await api.checkout.sessions.expire(sessionId);
      if (session.status !== "expired" || session.payment_status === "paid") {
        throw new ItineraryPaymentPending("A payment is processing. The itinerary cannot change until its result is confirmed.");
      }
      await client.query(
        "update payments set status = 'FAILED', metadata_json = coalesce(metadata_json, '{}'::jsonb) || $1::jsonb, updated_at = now() where id = $2",
        [JSON.stringify({ stripe_session_status: "expired", expired_for_itinerary_change_at: new Date().toISOString() }), attempt.id],
      );
    } catch (error) {
      if (error instanceof ItineraryPaymentPending) throw error;
      throw new ItineraryPaymentPending("Unable to safely establish the previous Checkout state. No booking changes were saved. Retry after payment reconciliation.");
    }
  }
}
