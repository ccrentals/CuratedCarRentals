import { computeHash } from "@/lib/wipay";
import {
  getInternalNotesRecipient,
  sendBookingOverriddenByPaidBookingEmail,
  sendDepositReceiptEmail,
  sendPaymentCompleteEmail,
} from "@/lib/notifications/email";
import {
  computeDedupeKey,
  markDedupeResult,
  tryAcquireDedupe,
} from "@/lib/notifications/dedupe";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { logError } from "@/lib/log";
import { readPromoPricingFields } from "@/lib/payments/pricing";
import { maybeEntitleBookingAfterPayment } from "@/lib/availability/entitlement";

type ReconcileInput = {
  orderId: string;
  transactionId: string;
  status: string;
  message?: string;
  total?: string;
  currency?: string;
  hash?: string;
  source: "return" | "webhook";
};

type ReconcileResult = {
  ok: boolean;
  bookingId?: string;
  reason?: "not_found" | "bad_hash" | "overlap" | "failed_status" | "db_error";
};

type ReconcileDependencies = {
  dbQuery: typeof dbQuery;
  getDbPool: typeof getDbPool;
  writeAuditLog: typeof writeAuditLog;
  recalculateBookingPayments: typeof recalculateBookingPayments;
  readPromoPricingFields: typeof readPromoPricingFields;
  maybeEntitleBookingAfterPayment: typeof maybeEntitleBookingAfterPayment;
  sendBookingOverriddenByPaidBookingEmail: typeof sendBookingOverriddenByPaidBookingEmail;
  sendDepositReceiptEmail: typeof sendDepositReceiptEmail;
  sendPaymentCompleteEmail: typeof sendPaymentCompleteEmail;
  getInternalNotesRecipient: typeof getInternalNotesRecipient;
  tryAcquireDedupe: typeof tryAcquireDedupe;
  markDedupeResult: typeof markDedupeResult;
};

const DEFAULT_RECONCILE_DEPENDENCIES: ReconcileDependencies = {
  dbQuery,
  getDbPool,
  writeAuditLog,
  recalculateBookingPayments,
  readPromoPricingFields,
  maybeEntitleBookingAfterPayment,
  sendBookingOverriddenByPaidBookingEmail,
  sendDepositReceiptEmail,
  sendPaymentCompleteEmail,
  getInternalNotesRecipient,
  tryAcquireDedupe,
  markDedupeResult,
};

function mergeMetadata(existing: Record<string, unknown> | null, incoming: Record<string, unknown>) {
  return {
    ...(existing ?? {}),
    wipay_last: incoming,
    updated_at: new Date().toISOString(),
  };
}

function normalizeDecimalAmount(value: string | undefined) {
  if (!value) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return parsed.toFixed(2);
}

function normalizeStatus(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isLocalSandboxHashCompatibilityMode() {
  if ((process.env.WIPAY_ENV ?? "").trim().toLowerCase() !== "sandbox") return false;

  const siteUrl = process.env.SITE_URL?.trim();
  if (!siteUrl) return false;

  try {
    const hostname = new URL(siteUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isSuccessfulWiPayStatus(status: string) {
  return status === "success" || status === "successful";
}

function isFailedWiPayStatus(status: string) {
  return (
    status === "fail" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "declined" ||
    status === "error"
  );
}

async function markLostBookingEmailSent(
  bookingId: string,
  winnerBookingId: string,
  deps: Pick<ReconcileDependencies, "dbQuery">,
) {
  const result = await deps.dbQuery(
    "update bookings set pricing_json = jsonb_set(jsonb_set(coalesce(pricing_json, '{}'::jsonb), '{lost_email_sent_at}', to_jsonb(now()::text), true), '{lost_email_sent_by_booking_id}', to_jsonb($2::text), true), updated_at = now() " +
      "where id = $1 and upper(coalesce(status, '')) = 'CANCELLED' and upper(coalesce(pricing_json->>'cancel_reason', '')) = 'LOST_TO_FIRST_DEPOSIT' and coalesce(pricing_json->>'overridden_by_booking_id', '') = $2 and coalesce(pricing_json->>'lost_email_sent_at', '') = '' " +
      "returning id",
    [bookingId, winnerBookingId],
  );
  return result.rowCount > 0;
}

export async function reconcileWiPayPayment(
  input: ReconcileInput,
  dependencyOverrides: Partial<ReconcileDependencies> = {},
): Promise<ReconcileResult> {
  const deps: ReconcileDependencies = {
    ...DEFAULT_RECONCILE_DEPENDENCIES,
    ...dependencyOverrides,
  };
  const statusNormalized = normalizeStatus(input.status);

  const paymentResult = await deps.dbQuery<{
    id: string;
    booking_id: string;
    status: string;
    provider_transaction_id: string | null;
    metadata_json: Record<string, unknown> | null;
  }>(
    "select id, booking_id, status, provider_transaction_id, metadata_json from payments where provider = 'WIPAY' and provider_ref = $1 order by created_at desc limit 1",
    [input.orderId],
  );

  if (paymentResult.rowCount === 0) {
    return { ok: false, reason: "not_found" };
  }

  const payment = paymentResult.rows[0];
  const metadata = payment.metadata_json ?? {};
  const totalDecimal = typeof metadata.total_decimal === "string" ? metadata.total_decimal : "";
  const receiptSent = Boolean((metadata as Record<string, unknown>).receipt_email_sent);
  const overlapReview = Boolean((metadata as Record<string, unknown>).overlap_review);
  const paymentType =
    typeof (metadata as Record<string, unknown>).payment_type === "string"
      ? String((metadata as Record<string, unknown>).payment_type)
      : "deposit";

  const apiKey = (process.env.WIPAY_API_KEY ?? "").trim();
  const normalizedReportedTotal = normalizeDecimalAmount(input.total);
  const normalizedStoredTotal = normalizeDecimalAmount(totalDecimal);
  const providedHash = String(input.hash ?? "").toLowerCase().trim();
  const reportedCurrency = String(input.currency ?? "").trim().toUpperCase();
  const responseMessage = String(input.message ?? "").trim();

  if (isFailedWiPayStatus(statusNormalized)) {
    if (payment.status !== "DEPOSIT_PAID") {
      await deps.dbQuery(
        "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
        [
          mergeMetadata(metadata, {
            ...input,
            status: input.status,
            hash_total_used: normalizedStoredTotal || null,
            hash_verified: false,
          }),
          payment.id,
        ],
      );
    }
    return { ok: false, reason: "failed_status" };
  }

  if (
    !input.transactionId ||
    !providedHash ||
    !normalizedStoredTotal ||
    !apiKey
  ) {
    return { ok: false, reason: "bad_hash" };
  }

  if (reportedCurrency && reportedCurrency !== "JMD") {
    return { ok: false, reason: "bad_hash" };
  }

  const expectedHash = computeHash(input.transactionId, normalizedStoredTotal, apiKey).toLowerCase();
  const localSandboxSuccessCompatibility =
    expectedHash !== providedHash &&
    isLocalSandboxHashCompatibilityMode() &&
    isSuccessfulWiPayStatus(statusNormalized) &&
    Boolean(normalizedReportedTotal) &&
    Boolean(input.orderId) &&
    input.transactionId.includes(input.orderId) &&
    /^\[1-/i.test(responseMessage);

  if (expectedHash !== providedHash && !localSandboxSuccessCompatibility) {
    return { ok: false, reason: "bad_hash" };
  }

  if (payment.status === "DEPOSIT_PAID") {
    if (payment.provider_transaction_id && payment.provider_transaction_id !== input.transactionId) {
      return { ok: false, reason: "bad_hash" };
    }
    if (!payment.provider_transaction_id) {
      await deps.dbQuery(
        "update payments set provider_transaction_id = $1, metadata_json = $2, updated_at = now() where id = $3",
        [
          input.transactionId,
          mergeMetadata(metadata, {
            ...input,
            status: input.status,
            hash_total_used: normalizedStoredTotal,
            hash_verified: !localSandboxSuccessCompatibility,
            hash_compatibility_mode: localSandboxSuccessCompatibility ? "local_sandbox_success" : null,
          }),
          payment.id,
        ],
      );
    }
    if (overlapReview) return { ok: false, reason: "overlap", bookingId: payment.booking_id };
    return { ok: true, bookingId: payment.booking_id };
  }

  if (!isSuccessfulWiPayStatus(statusNormalized)) {
    await deps.dbQuery(
      "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
      [
        mergeMetadata(metadata, {
          ...input,
          status: input.status,
          hash_total_used: normalizedStoredTotal,
          hash_verified: !localSandboxSuccessCompatibility,
          hash_compatibility_mode: localSandboxSuccessCompatibility ? "local_sandbox_success" : null,
        }),
        payment.id,
      ],
    );
    return { ok: false, reason: "failed_status" };
  }

  const pool = deps.getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    await client.query(
      "update payments set status = 'DEPOSIT_PAID', provider_transaction_id = $1, metadata_json = $2, updated_at = now() where id = $3 and status <> 'DEPOSIT_PAID'",
      [
        input.transactionId,
        mergeMetadata(metadata, {
          ...input,
          status: input.status,
          hash_total_used: normalizedStoredTotal,
          hash_verified: !localSandboxSuccessCompatibility,
          hash_compatibility_mode: localSandboxSuccessCompatibility ? "local_sandbox_success" : null,
        }),
        payment.id,
      ],
    );
    await client.query(
      "update payments set status = 'FAILED', metadata_json = jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{superseded_by_payment_id}', to_jsonb($1::text), true), updated_at = now() " +
        "where booking_id = $2 and provider = 'WIPAY' and status = 'INITIATED' and provider_transaction_id is null and id <> $1 and coalesce(metadata_json->>'payment_type', 'deposit') = $3",
      [payment.id, payment.booking_id, paymentType],
    );

    const entitlementResolution = await deps.maybeEntitleBookingAfterPayment(payment.booking_id, {
      client,
      auditUserId: "system",
    });
    const recalculated = await deps.recalculateBookingPayments(payment.booking_id, { client });

    if (entitlementResolution.state === "LOST") {
      await client.query(
        "update payments set metadata_json = jsonb_set(metadata_json, '{overlap_review}', 'true'::jsonb, true), updated_at = now() where id = $1",
        [payment.id],
      );
      await client.query(
        "update payments set metadata_json = jsonb_set(metadata_json, '{entitlement_winner_booking_id}', to_jsonb($2::text), true), updated_at = now() where id = $1",
        [payment.id, entitlementResolution.winnerBookingId],
      );

      await client.query("commit");
      await deps.writeAuditLog({
        userId: "system",
        action:
          paymentType === "full"
            ? "PAYMENT_FULL_OVERLAP_REVIEW"
            : paymentType === "balance"
              ? "PAYMENT_BALANCE_OVERLAP_REVIEW"
              : "PAYMENT_DEPOSIT_OVERLAP_REVIEW",
        entityType: "booking",
        entityId: payment.booking_id,
        details: {
          paymentId: payment.id,
          orderId: input.orderId,
          transactionId: input.transactionId,
          source: input.source,
          netPaidToDate: recalculated.netPaidToDate,
          balanceDue: recalculated.balanceDue,
          winnerBookingId: entitlementResolution.winnerBookingId,
          entitlementState: entitlementResolution.state,
        },
      });
      return { ok: false, reason: "overlap", bookingId: payment.booking_id };
    }

    const bookingResult = await client.query(
      "select b.id, b.start_date, b.end_date, b.status, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [payment.booking_id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_found" };
    }

    const booking = bookingResult.rows[0];

    await client.query("commit");

    await deps.writeAuditLog({
      userId: "system",
      action:
        paymentType === "deposit"
          ? "PAYMENT_DEPOSIT_CONFIRMED_WIPAY"
          : paymentType === "full"
            ? "PAYMENT_FULL_CONFIRMED_WIPAY"
            : "PAYMENT_BALANCE_CONFIRMED_WIPAY",
      entityType: "booking",
      entityId: booking.id,
      details: {
        paymentId: payment.id,
        orderId: input.orderId,
        transactionId: input.transactionId,
        source: input.source,
        netPaidToDate: recalculated.netPaidToDate,
        balanceDue: recalculated.balanceDue,
        entitlementState: entitlementResolution.state,
        overriddenBookings: entitlementResolution.cancelledOverlaps.map((bookingRow) => bookingRow.id),
      },
    });

    for (const overriddenBooking of entitlementResolution.cancelledOverlaps) {
      const shouldSendLostEmail = await markLostBookingEmailSent(
        overriddenBooking.id,
        booking.id,
        deps,
      );
      if (!shouldSendLostEmail) {
        continue;
      }

      const overriddenDedupeKey = computeDedupeKey({
        entityType: "booking",
        entityId: overriddenBooking.id,
        eventType: "OVERRIDDEN_NOTICE",
        extra: booking.id,
      });
      const overriddenDedupe = await deps.tryAcquireDedupe(
        {
          dedupeKey: overriddenDedupeKey,
          entityType: "booking",
          entityId: overriddenBooking.id,
          eventType: "OVERRIDDEN_NOTICE",
          provider: "resend",
        },
        deps.dbQuery,
      );

      if (!overriddenDedupe.acquired) {
        continue;
      }

      try {
        await deps.writeAuditLog({
          userId: "system",
          action: "BOOKING_OVERRIDDEN_BY_PAID_BOOKING",
          entityType: "booking",
          entityId: overriddenBooking.id,
          details: {
            overriddenByBookingId: booking.id,
            overrideReason: "Overridden by paid booking",
          },
        });

        await deps.sendBookingOverriddenByPaidBookingEmail({
          recipientType: "customer",
          recipientEmail: overriddenBooking.customerEmail,
          bookingId: overriddenBooking.id,
          customerName: overriddenBooking.customerName,
          customerEmail: overriddenBooking.customerEmail,
          vehicleLabel: overriddenBooking.vehicleLabel,
          startDate: overriddenBooking.startDate,
          endDate: overriddenBooking.endDate,
          pickupLocation: overriddenBooking.pickupLocation,
          overriddenByBookingId: booking.id,
        });

        await deps.sendBookingOverriddenByPaidBookingEmail({
          recipientType: "internal",
          recipientEmail: deps.getInternalNotesRecipient(),
          bookingId: overriddenBooking.id,
          customerName: overriddenBooking.customerName,
          customerEmail: overriddenBooking.customerEmail,
          vehicleLabel: overriddenBooking.vehicleLabel,
          startDate: overriddenBooking.startDate,
          endDate: overriddenBooking.endDate,
          pickupLocation: overriddenBooking.pickupLocation,
          overriddenByBookingId: booking.id,
        });

        await deps.markDedupeResult(
          {
            dedupeKey: overriddenDedupeKey,
            status: "SENT",
            provider: "resend",
          },
          deps.dbQuery,
        );
      } catch (error) {
        await deps.markDedupeResult(
          {
            dedupeKey: overriddenDedupeKey,
            status: "FAILED",
            provider: "resend",
            error: error instanceof Error ? error.message : String(error),
          },
          deps.dbQuery,
        );
        logError("wipay_overridden_notice_email_failed", error, {
          bookingId: overriddenBooking.id,
          winnerBookingId: booking.id,
          orderId: input.orderId,
          transactionId: input.transactionId,
          source: input.source,
        });
      }
    }

    if (!receiptSent) {
      const paymentEmailEventType =
        paymentType !== "deposit" ? "PAYMENT_COMPLETE" : "DEPOSIT_RECEIPT";
      const paymentEmailDedupeKey = computeDedupeKey({
        entityType: "booking",
        entityId: booking.id,
        eventType: paymentEmailEventType,
        extra: payment.id,
      });

      const dedupeDecision = await deps.tryAcquireDedupe(
        {
          dedupeKey: paymentEmailDedupeKey,
          entityType: "booking",
          entityId: booking.id,
          eventType: paymentEmailEventType,
          provider: "resend",
        },
        deps.dbQuery,
      );

      if (!dedupeDecision.acquired) {
        await deps.dbQuery(
          "update payments set metadata_json = jsonb_set(metadata_json, '{receipt_email_sent}', 'true'::jsonb, true), updated_at = now() where id = $1",
          [payment.id],
        );
      } else {
        try {
          const bookingPricing = (
            booking.pricing_json && typeof booking.pricing_json === "object"
              ? (booking.pricing_json as Record<string, unknown>)
              : null
          );
          const { promoCode, promoDiscount } = deps.readPromoPricingFields(bookingPricing);

          const emailResult =
            paymentType !== "deposit"
              ? await deps.sendPaymentCompleteEmail({
                  bookingId: booking.id,
                  customerEmail: booking.customer_email,
                  customerName: booking.customer_name,
                  vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
                  startDate: booking.start_date,
                  endDate: booking.end_date,
                  pickupLocation: booking.pickup_location,
                  dailyRate: Number(booking.daily_rate_cents || 0),
                  deposit: Number(booking.deposit_cents || 0),
                  total: recalculated.totalAmount,
                  paidToDate: recalculated.netPaidToDate,
                  balanceDue: recalculated.balanceDue,
                })
              : await deps.sendDepositReceiptEmail({
                  bookingId: booking.id,
                  customerEmail: booking.customer_email,
                  customerName: booking.customer_name,
                  vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
                  startDate: booking.start_date,
                  endDate: booking.end_date,
                  pickupLocation: booking.pickup_location,
                  dailyRate: Number(booking.daily_rate_cents || 0),
                  deposit: Number(booking.deposit_cents || 0),
                  paidToDate: recalculated.netPaidToDate,
                  promoCode,
                  promoDiscount,
                });

          if (!emailResult.ok) {
            throw new Error(
              emailResult.error ??
                (paymentType !== "deposit"
                  ? "Payment complete email failed"
                  : "Deposit receipt email failed"),
            );
          }

          await deps.markDedupeResult(
            {
              dedupeKey: paymentEmailDedupeKey,
              status: "SENT",
              provider: "resend",
            },
            deps.dbQuery,
          );

          await deps.dbQuery(
            "update payments set metadata_json = jsonb_set(metadata_json, '{receipt_email_sent}', 'true'::jsonb, true), updated_at = now() where id = $1",
            [payment.id],
          );
        } catch (error) {
          await deps.markDedupeResult(
            {
              dedupeKey: paymentEmailDedupeKey,
              status: "FAILED",
              provider: "resend",
              error: error instanceof Error ? error.message : String(error),
            },
            deps.dbQuery,
          );

          logError(
            paymentType !== "deposit"
              ? "wipay_payment_complete_email_failed"
              : "wipay_deposit_receipt_email_failed",
            error,
            {
              bookingId: booking.id,
              paymentId: payment.id,
              orderId: input.orderId,
              transactionId: input.transactionId,
              source: input.source,
            },
          );
        }
      }
    }

    return { ok: true, bookingId: booking.id };
  } catch (error) {
    await client.query("rollback");
    logError("wipay_reconcile_failed", error, {
      orderId: input.orderId,
      transactionId: input.transactionId,
      source: input.source,
      paymentId: payment.id,
      bookingId: payment.booking_id,
    });
    return { ok: false, reason: "db_error", bookingId: payment.booking_id };
  } finally {
    client.release();
  }
}
