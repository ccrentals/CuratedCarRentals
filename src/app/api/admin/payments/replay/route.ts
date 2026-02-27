import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { reconcileWiPayPayment } from "@/lib/payments/wipayReconcile";
import { requireCsrf } from "@/lib/security/csrf";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WipayPaymentRow = {
  id: string;
  bookingId: string;
  providerRef: string | null;
  providerTransactionId: string | null;
  status: string;
  metadataJson: Record<string, unknown> | null;
};

type PaymentLookupRow = {
  id: string;
  booking_id: string;
  provider_ref: string | null;
  provider_transaction_id: string | null;
  status: string;
  metadata_json: Record<string, unknown> | null;
};

type ReplayOutcomeReason =
  | "INVALID_INPUT"
  | "PAYMENT_NOT_FOUND"
  | "MISSING_PROVIDER_CONTEXT"
  | "RECONCILE_NOT_FOUND"
  | "BAD_HASH"
  | "FAILED_STATUS"
  | "OVERLAP_REVIEW_REQUIRED"
  | "RECONCILE_DB_ERROR"
  | "RECONCILE_FAILED";

type ReplaySource = "admin_replay";
type ReconcileFailureReason = Awaited<ReturnType<typeof reconcileWiPayPayment>>["reason"];

type AdminPaymentsReplayRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  findLatestPaymentByOrderId: (orderId: string) => Promise<WipayPaymentRow | null>;
  findLatestPaymentByTransactionId: (transactionId: string) => Promise<WipayPaymentRow | null>;
  findLatestPaymentByBookingId: (bookingId: string) => Promise<WipayPaymentRow | null>;
  reconcilePayment: typeof reconcileWiPayPayment;
  writeAudit: typeof writeAuditLog;
};

type ReplayBody = {
  bookingId?: unknown;
  orderId?: unknown;
  transactionId?: unknown;
  status?: unknown;
  total?: unknown;
  currency?: unknown;
  hash?: unknown;
  message?: unknown;
  source?: unknown;
  csrfToken?: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSource(value: unknown): ReplaySource {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "admin_replay") return "admin_replay";
  return "admin_replay";
}

function pickFirstString(
  keys: string[],
  ...sources: Array<Record<string, unknown> | null>
) {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const raw = source[key];
      const normalized = normalizeString(raw);
      if (normalized) return normalized;
    }
  }
  return "";
}

function mapPaymentRow(row: PaymentLookupRow): WipayPaymentRow {
  return {
    id: row.id,
    bookingId: row.booking_id,
    providerRef: row.provider_ref,
    providerTransactionId: row.provider_transaction_id,
    status: row.status,
    metadataJson: row.metadata_json ?? null,
  };
}

async function findLatestPaymentBy(
  whereSql: string,
  value: string,
): Promise<WipayPaymentRow | null> {
  const result = await dbQuery<PaymentLookupRow>(
    `select id, booking_id, provider_ref, provider_transaction_id, status, metadata_json
       from payments
      where provider = 'WIPAY'
        and deleted_at is null
        and ${whereSql}
      order by created_at desc
      limit 1`,
    [value],
  );

  if (result.rowCount === 0) return null;
  return mapPaymentRow(result.rows[0]);
}

const DEFAULT_DEPS: AdminPaymentsReplayRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  findLatestPaymentByOrderId: (orderId) => findLatestPaymentBy("provider_ref = $1", orderId),
  findLatestPaymentByTransactionId: (transactionId) =>
    findLatestPaymentBy("provider_transaction_id = $1", transactionId),
  findLatestPaymentByBookingId: (bookingId) =>
    findLatestPaymentBy("booking_id = $1::uuid", bookingId),
  reconcilePayment: (input, overrides) => reconcileWiPayPayment(input, overrides),
  writeAudit: (input) => writeAuditLog(input),
};

function replayError(
  status: number,
  code: ReplayOutcomeReason,
  error: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      ok: false,
      code,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function isSandboxEnvironment() {
  return normalizeString(process.env.WIPAY_ENV).toLowerCase() === "sandbox";
}

function mapReconcileFailure(reason: ReconcileFailureReason): {
  status: number;
  code: ReplayOutcomeReason;
  message: string;
} {
  if (reason === "not_found") {
    return {
      status: 404,
      code: "RECONCILE_NOT_FOUND",
      message: "Replay target booking/payment context was not found.",
    };
  }
  if (reason === "bad_hash") {
    return {
      status: 409,
      code: "BAD_HASH",
      message: "Replay failed WiPay hash verification.",
    };
  }
  if (reason === "failed_status") {
    return {
      status: 409,
      code: "FAILED_STATUS",
      message: "Replay payload indicates a non-successful provider status.",
    };
  }
  if (reason === "overlap") {
    return {
      status: 409,
      code: "OVERLAP_REVIEW_REQUIRED",
      message: "Replay requires manual overlap review.",
    };
  }
  if (reason === "db_error") {
    return {
      status: 500,
      code: "RECONCILE_DB_ERROR",
      message: "Replay failed while applying reconciliation updates.",
    };
  }
  return {
    status: 500,
    code: "RECONCILE_FAILED",
    message: "Replay failed.",
  };
}

async function writeReplayAudit(
  deps: AdminPaymentsReplayRouteDeps,
  input: {
    actorUserId: string;
    paymentId?: string | null;
    bookingId?: string | null;
    orderId?: string | null;
    transactionId?: string | null;
    replaySource: ReplaySource;
    outcome: { ok: boolean; reason?: string };
    note?: string;
    details?: Record<string, unknown>;
  },
) {
  try {
    await deps.writeAudit({
      userId: input.actorUserId,
      action: "PAYMENT_WIPAY_REPLAY_REQUESTED",
      entityType: "payment",
      entityId: input.paymentId ?? undefined,
      details: {
        bookingId: input.bookingId ?? null,
        orderId: input.orderId ?? null,
        transactionId: input.transactionId ?? null,
        replaySource: input.replaySource,
        outcome: input.outcome,
        note: input.note ?? null,
        ...(input.details ?? {}),
      },
    });
  } catch (error) {
    logError("admin_payments_replay_audit_failed", error, {
      paymentId: input.paymentId ?? null,
      bookingId: input.bookingId ?? null,
      orderId: input.orderId ?? null,
    });
  }
}

export async function handleAdminPaymentsReplayPost(
  request: Request,
  deps: AdminPaymentsReplayRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminRole({
    getSession: deps.getSession,
    forbiddenMessage: "Forbidden",
  });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = (await request.json().catch(() => null)) as ReplayBody | null;

  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const bookingId = normalizeString(body?.bookingId);
  const orderId = normalizeString(body?.orderId);
  const transactionId = normalizeString(body?.transactionId);
  const replaySource = normalizeSource(body?.source);
  const statusInput = normalizeString(body?.status);
  const totalInput = normalizeString(body?.total);
  const currencyInput = normalizeString(body?.currency);
  const hashInput = normalizeString(body?.hash);
  const messageInput = normalizeString(body?.message);

  if (!bookingId && !orderId && !transactionId) {
    await writeReplayAudit(deps, {
      actorUserId: actor.userId,
      replaySource,
      outcome: { ok: false, reason: "INVALID_INPUT" },
      note: "Replay requires at least one lookup key.",
    });
    return replayError(400, "INVALID_INPUT", "Provide bookingId, orderId, or transactionId.");
  }

  if (bookingId && !UUID_RE.test(bookingId)) {
    await writeReplayAudit(deps, {
      actorUserId: actor.userId,
      replaySource,
      outcome: { ok: false, reason: "INVALID_INPUT" },
      note: "Invalid bookingId format.",
      details: { bookingId },
    });
    return replayError(400, "INVALID_INPUT", "bookingId must be a valid UUID.");
  }

  let payment: WipayPaymentRow | null = null;
  if (orderId) {
    payment = await deps.findLatestPaymentByOrderId(orderId);
  } else if (transactionId) {
    payment = await deps.findLatestPaymentByTransactionId(transactionId);
  } else if (bookingId) {
    payment = await deps.findLatestPaymentByBookingId(bookingId);
  }

  if (!payment) {
    await writeReplayAudit(deps, {
      actorUserId: actor.userId,
      bookingId: bookingId || null,
      orderId: orderId || null,
      transactionId: transactionId || null,
      replaySource,
      outcome: { ok: false, reason: "PAYMENT_NOT_FOUND" },
      note: "No WiPay payment row found for replay lookup.",
    });
    return replayError(404, "PAYMENT_NOT_FOUND", "No matching WiPay payment was found.");
  }

  const metadata = asObject(payment.metadataJson);
  const wipayLast = asObject(metadata?.wipay_last);

  const metadataTotalDecimal = normalizeString(metadata?.total_decimal);
  const resolvedOrderId =
    orderId ||
    normalizeString(payment.providerRef) ||
    pickFirstString(["order_id", "orderId", "order"], wipayLast, metadata);
  const resolvedTransactionId =
    transactionId ||
    normalizeString(payment.providerTransactionId) ||
    pickFirstString(["transaction_id", "transactionId", "transaction"], wipayLast, metadata);
  let resolvedStatus =
    statusInput || pickFirstString(["status"], wipayLast, metadata);
  const resolvedTotal =
    totalInput ||
    pickFirstString(["total"], wipayLast, metadata) ||
    metadataTotalDecimal;
  const resolvedCurrency =
    currencyInput || pickFirstString(["currency"], wipayLast, metadata);
  const resolvedHash =
    hashInput || pickFirstString(["hash"], wipayLast, metadata);

  if (!resolvedStatus && normalizeString(payment.status).toUpperCase() === "DEPOSIT_PAID") {
    resolvedStatus = "SUCCESS";
  }

  const missingContext: string[] = [];
  if (!resolvedOrderId) missingContext.push("orderId");
  if (!resolvedStatus) missingContext.push("status");

  const statusNormalized = resolvedStatus.toLowerCase();
  const replayingPendingSuccess =
    statusNormalized === "success" &&
    normalizeString(payment.status).toUpperCase() !== "DEPOSIT_PAID";
  if (replayingPendingSuccess) {
    if (!resolvedTransactionId) missingContext.push("transactionId");
    if (!resolvedHash) missingContext.push("hash");
    if (!resolvedTotal) missingContext.push("total");
    if (!metadataTotalDecimal) missingContext.push("metadata.total_decimal");
  }

  if (missingContext.length > 0) {
    await writeReplayAudit(deps, {
      actorUserId: actor.userId,
      paymentId: payment.id,
      bookingId: payment.bookingId,
      orderId: resolvedOrderId || null,
      transactionId: resolvedTransactionId || null,
      replaySource,
      outcome: { ok: false, reason: "MISSING_PROVIDER_CONTEXT" },
      note: "Replay payload/context is incomplete.",
      details: {
        missingContext,
        sandbox: isSandboxEnvironment(),
      },
    });

    return replayError(
      409,
      "MISSING_PROVIDER_CONTEXT",
      "Replay is missing required provider context.",
      { missingContext, sandbox: isSandboxEnvironment() },
    );
  }

  const reconcileResult = await deps.reconcilePayment({
    orderId: resolvedOrderId,
    transactionId: resolvedTransactionId,
    status: resolvedStatus,
    total: resolvedTotal || undefined,
    currency: resolvedCurrency || undefined,
    hash: resolvedHash || undefined,
    message: messageInput || `admin_replay:${replaySource}`,
    source: "webhook",
  });

  if (!reconcileResult.ok) {
    const mapped = mapReconcileFailure(reconcileResult.reason);
    await writeReplayAudit(deps, {
      actorUserId: actor.userId,
      paymentId: payment.id,
      bookingId: payment.bookingId,
      orderId: resolvedOrderId,
      transactionId: resolvedTransactionId || null,
      replaySource,
      outcome: { ok: false, reason: reconcileResult.reason ?? mapped.code },
      note: mapped.message,
    });

    return replayError(mapped.status, mapped.code, mapped.message, {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      outcome: reconcileResult,
    });
  }

  const note =
    normalizeString(payment.status).toUpperCase() === "DEPOSIT_PAID"
      ? "Replay completed idempotently for already-paid record."
      : "Replay completed.";

  await writeReplayAudit(deps, {
    actorUserId: actor.userId,
    paymentId: payment.id,
    bookingId: reconcileResult.bookingId ?? payment.bookingId,
    orderId: resolvedOrderId,
    transactionId: resolvedTransactionId || null,
    replaySource,
    outcome: { ok: true },
    note,
  });

  return NextResponse.json({
    ok: true,
    bookingId: reconcileResult.bookingId ?? payment.bookingId,
    paymentId: payment.id,
    outcome: { ok: true as const },
    note,
  });
}

export async function POST(request: Request) {
  return handleAdminPaymentsReplayPost(request);
}
