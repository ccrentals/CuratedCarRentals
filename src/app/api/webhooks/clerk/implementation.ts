import { NextResponse } from "next/server";
import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";

import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import { applyClerkIdentityToLocal, toClerkIdentityRecord } from "@/lib/auth/clerkIdentitySync";
import { logError } from "@/lib/log";

export type ClerkWebhookRouteDeps = {
  verify: (request: Request) => Promise<WebhookEvent>;
  processEvent: (input: { event: WebhookEvent; eventId: string | null }) => Promise<{
    handled: boolean;
    duplicate?: boolean;
    syncResult?: Awaited<ReturnType<typeof applyClerkIdentityToLocal>>;
  }>;
};

const DEFAULT_DEPS: ClerkWebhookRouteDeps = {
  verify: (request) => verifyWebhook(request as never),
  processEvent: ({ event, eventId }) => processClerkWebhookEvent({ event, eventId }),
};

async function markWebhookDelivery(eventId: string | null) {
  if (!eventId) {
    return { duplicate: false };
  }

  const inserted = await dbQuery<{ id: string }>(
    "insert into webhook_events (provider, event_id) values ($1, $2) on conflict (provider, event_id) do nothing returning id",
    ["CLERK", eventId],
  );
  return { duplicate: inserted.rowCount === 0 };
}

async function auditUnhandledSync(input: {
  event: WebhookEvent;
  eventId: string | null;
  syncResult: Awaited<ReturnType<typeof applyClerkIdentityToLocal>>;
}) {
  await writeAuditLog({
    action: "CLERK_IDENTITY_SYNC_SKIPPED",
    entityType: "clerk_identity_sync",
    entityId: input.syncResult.localUserId ?? input.syncResult.clerkUserId,
    details: {
      eventType: input.event.type,
      eventId: input.eventId,
      clerkUserId: input.syncResult.clerkUserId,
      localUserId: input.syncResult.localUserId,
      status: input.syncResult.status,
      message: input.syncResult.message,
    },
  });
}

export async function processClerkWebhookEvent(input: {
  event: WebhookEvent;
  eventId: string | null;
}) {
  const dedupe = await markWebhookDelivery(input.eventId);
  if (dedupe.duplicate) {
    return { handled: true, duplicate: true };
  }

  if (
    input.event.type !== "user.created" &&
    input.event.type !== "user.updated" &&
    input.event.type !== "user.deleted"
  ) {
    return { handled: false, duplicate: false };
  }

  const identity = toClerkIdentityRecord(input.event.data);
  if (!identity) {
    await writeAuditLog({
      action: "CLERK_IDENTITY_SYNC_SKIPPED",
      entityType: "clerk_identity_sync",
      details: {
        eventType: input.event.type,
        eventId: input.eventId,
        reason: "invalid_identity_payload",
      },
    });
    return { handled: true, duplicate: false };
  }

  const syncResult = await applyClerkIdentityToLocal(
    {
      identity: {
        ...identity,
        deleted: input.event.type === "user.deleted" || identity.deleted,
      },
      source: "webhook",
      sourceEventId: input.eventId,
      sourceEventType: input.event.type,
    },
  );

  if (!syncResult.ok) {
    await auditUnhandledSync({
      event: input.event,
      eventId: input.eventId,
      syncResult,
    });
  }

  return {
    handled: true,
    duplicate: false,
    syncResult,
  };
}

export async function handleClerkWebhookPost(
  request: Request,
  deps: ClerkWebhookRouteDeps = DEFAULT_DEPS,
) {
  const eventId = request.headers.get("svix-id");

  let event: WebhookEvent;
  try {
    event = await deps.verify(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Webhook verification failed." }, { status: 400 });
  }

  try {
    const result = await deps.processEvent({ event, eventId });
    if (!result.handled) {
      return NextResponse.json({ ok: true, ignored: true, eventType: event.type });
    }

    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate ?? false,
      eventType: event.type,
      syncStatus: result.syncResult?.status ?? null,
    });
  } catch (error) {
    logError("clerk_webhook_processing_failed", error, {
      eventId,
      eventType: event.type,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to process Clerk webhook event." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleClerkWebhookPost(request);
}
