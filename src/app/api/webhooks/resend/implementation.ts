import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import {
  normalizeResendWebhookEvent,
  processResendWebhookEvent,
  verifyResendWebhookSignature,
  type ResendWebhookEvent,
  type ResendWebhookProcessResult,
  type ResendWebhookVerificationResult,
} from "@/lib/notifications/resendWebhook";

export type ResendWebhookRouteDeps = {
  getWebhookSecret: () => string | null;
  verifySignature: (input: {
    rawBody: string;
    headers: Headers;
    secret: string;
  }) => ResendWebhookVerificationResult;
  processEvent: (event: ResendWebhookEvent) => Promise<ResendWebhookProcessResult>;
};

const DEFAULT_DEPS: ResendWebhookRouteDeps = {
  getWebhookSecret: () => process.env.RESEND_WEBHOOK_SECRET?.trim() || null,
  verifySignature: (input) => verifyResendWebhookSignature(input),
  processEvent: (event) => processResendWebhookEvent(event),
};

export async function handleResendWebhookPost(
  request: Request,
  deps: ResendWebhookRouteDeps = DEFAULT_DEPS,
) {
  const rawBody = await request.text().catch(() => "");
  const webhookSecret = deps.getWebhookSecret();
  if (!webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "RESEND_WEBHOOK_SECRET is not configured." },
      { status: 503 },
    );
  }

  const verification = deps.verifySignature({
    rawBody,
    headers: request.headers,
    secret: webhookSecret,
  });

  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, error: verification.error },
      { status: verification.status },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const event = normalizeResendWebhookEvent(payload, request.headers.get("svix-id"));
  if (!event) {
    return NextResponse.json({ ok: false, error: "Invalid Resend event payload." }, { status: 400 });
  }

  try {
    const result = await deps.processEvent(event);
    if (!result.handled) {
      return NextResponse.json({ ok: true, ignored: true, eventType: result.eventType });
    }

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      eventType: result.eventType,
      notificationId: result.notificationId,
      correlation: result.correlation,
    });
  } catch (error) {
    logError("resend_webhook_processing_failed", error, {
      eventType: event.eventType,
      providerEmailId: event.providerEmailId,
      recipientEmail: event.primaryRecipient,
      webhookMessageId: event.webhookMessageId,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to process Resend webhook event." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleResendWebhookPost(request);
}
