import { computeHash } from "@/lib/wipay";
import { sendDepositReceiptEmail, sendPaymentCompleteEmail } from "@/lib/notifications/email";
import { dbQuery, getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";

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
  reason?: "not_found" | "bad_hash" | "overlap" | "failed_status";
};

function mergeMetadata(existing: Record<string, unknown> | null, incoming: Record<string, unknown>) {
  return {
    ...(existing ?? {}),
    wipay_last: incoming,
    updated_at: new Date().toISOString(),
  };
}

function buildTotalCandidates(totalDecimal: string, rawTotal?: string) {
  const candidates = new Set<string>();
  if (totalDecimal) candidates.add(totalDecimal);
  if (rawTotal) candidates.add(rawTotal);

  if (rawTotal) {
    const numeric = Number(rawTotal);
    if (Number.isFinite(numeric)) {
      candidates.add(numeric.toFixed(2));
      candidates.add(String(numeric));
    }
  }

  return Array.from(candidates).filter((value) => value.length > 0);
}

export async function reconcileWiPayPayment(input: ReconcileInput): Promise<ReconcileResult> {
  const statusNormalized = input.status.toLowerCase();

  const paymentResult = await dbQuery<{
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

  if (payment.status === "DEPOSIT_PAID") {
    if (input.transactionId && payment.provider_transaction_id !== input.transactionId) {
      await dbQuery(
        "update payments set provider_transaction_id = $1, metadata_json = $2, updated_at = now() where id = $3",
        [
          input.transactionId,
          mergeMetadata(metadata, { ...input, status: input.status }),
          payment.id,
        ],
      );
    }
    if (overlapReview) return { ok: false, reason: "overlap", bookingId: payment.booking_id };
    return { ok: true, bookingId: payment.booking_id };
  }

  if (statusNormalized !== "success") {
    await dbQuery(
      "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
      [mergeMetadata(metadata, { ...input, status: input.status }), payment.id],
    );
    return { ok: false, reason: "failed_status" };
  }

  if (!input.transactionId || !input.hash || !totalDecimal) {
    await dbQuery(
      "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
      [mergeMetadata(metadata, { ...input, status: input.status }), payment.id],
    );
    return { ok: false, reason: "bad_hash" };
  }

  const apiKey = process.env.WIPAY_API_KEY ?? "";
  const totalsToTry = buildTotalCandidates(totalDecimal, input.total);
  const providedHash = String(input.hash).toLowerCase();
  let hashMatchedTotal = "";
  let hashVerified = true;

  for (const candidate of totalsToTry) {
    const expectedHash = computeHash(input.transactionId, candidate, apiKey).toLowerCase();
    if (expectedHash === providedHash) {
      hashMatchedTotal = candidate;
      break;
    }
  }

  if (!hashMatchedTotal) {
    const sandboxMode = (process.env.WIPAY_ENV ?? "").toLowerCase() === "sandbox";
    if (sandboxMode) {
      hashVerified = false;
      hashMatchedTotal = totalDecimal || input.total || "";
    } else {
      await dbQuery(
        "update payments set status = 'FAILED', metadata_json = $1, updated_at = now() where id = $2",
        [
          mergeMetadata(metadata, {
            ...input,
            status: input.status,
            hash_expected_total: totalDecimal,
            hash_attempted_totals: totalsToTry,
          }),
          payment.id,
        ],
      );
      return { ok: false, reason: "bad_hash" };
    }
  }

  const pool = getDbPool();
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
          hash_total_used: hashMatchedTotal,
          hash_verified: hashVerified,
        }),
        payment.id,
      ],
    );

    const bookingResult = await client.query(
      "select b.id, b.vehicle_id, b.start_date, b.end_date, b.status, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [payment.booking_id],
    );

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return { ok: false, reason: "not_found" };
    }

    const booking = bookingResult.rows[0];

    if (paymentType === "balance") {
      const pricing = booking.pricing_json ?? {};
      const startDate = new Date(booking.start_date);
      const endDate = new Date(booking.end_date);
      const fallbackDays = Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
        ? 1
        : Math.max(
            1,
            Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
          );
      // Always compute days from booking dates so totals match the customer UI and what we charge via WiPay.
      const days = fallbackDays;
      const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
      const total = dailyRate * days;

      const paidResult = await client.query(
        "select coalesce(sum(deposit_amount_cents), 0) as amount from payments where booking_id = $1 and status = 'DEPOSIT_PAID'",
        [booking.id],
      );
      const paidToDate = Number(paidResult.rows[0]?.amount ?? 0);
      const balanceDue = Math.max(0, total - paidToDate);

      const updatedPricing = {
        ...pricing,
        daily_rate_cents: dailyRate,
        deposit_cents: Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0),
        days,
        subtotal_cents: total,
        paid_to_date: paidToDate,
        balance_due: balanceDue,
        paid_in_full: balanceDue <= 0,
        balance_paid: balanceDue <= 0,
        balance_paid_amount_cents:
          balanceDue <= 0
            ? Math.max(0, total - Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0))
            : 0,
      };

      await client.query("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
        updatedPricing,
        booking.id,
      ]);

      const shouldConfirmBooking = booking.status === "PENDING_PAYMENT";
      if (shouldConfirmBooking) {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [booking.vehicle_id]);

        const overlapResult = await client.query(
          "select id from bookings where vehicle_id = $1 and status in ('CONFIRMED','PICKED_UP') and id <> $2 and not ($4 < start_date or $3 > end_date)",
          [booking.vehicle_id, booking.id, booking.start_date, booking.end_date],
        );

        if (overlapResult.rowCount > 0) {
          await client.query(
            "update payments set metadata_json = jsonb_set(metadata_json, '{overlap_review}', 'true'::jsonb, true), updated_at = now() where id = $1",
            [payment.id],
          );
          await client.query("commit");
          await writeAuditLog({
            userId: "system",
            action: "PAYMENT_FULL_OVERLAP_REVIEW",
            entityType: "booking",
            entityId: booking.id,
            details: {
              paymentId: payment.id,
              orderId: input.orderId,
              transactionId: input.transactionId,
              source: input.source,
            },
          });
          return { ok: false, reason: "overlap", bookingId: booking.id };
        }

        await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
          booking.id,
        ]);
      }

      await client.query("commit");

      await writeAuditLog({
        userId: "system",
        action: shouldConfirmBooking ? "PAYMENT_FULL_CONFIRMED_WIPAY" : "PAYMENT_BALANCE_CONFIRMED_WIPAY",
        entityType: "booking",
        entityId: booking.id,
        details: {
          paymentId: payment.id,
          orderId: input.orderId,
          transactionId: input.transactionId,
          source: input.source,
        },
      });

      try {
        await sendPaymentCompleteEmail({
          bookingId: booking.id,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
          startDate: booking.start_date,
          endDate: booking.end_date,
          pickupLocation: booking.pickup_location,
          dailyRate: Number(booking.daily_rate_cents || 0),
          deposit: Number(booking.deposit_cents || 0),
          total,
          paidToDate,
          balanceDue,
        });
      } catch (error) {
        logError("wipay_balance_receipt_email_failed", error, {
          bookingId: booking.id,
          paymentId: payment.id,
          orderId: input.orderId,
          transactionId: input.transactionId,
          source: input.source,
        });
      }

      return { ok: true, bookingId: booking.id };
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [booking.vehicle_id]);

    const overlapResult = await client.query(
      "select id from bookings where vehicle_id = $1 and status in ('CONFIRMED','PICKED_UP') and id <> $2 and not ($4 < start_date or $3 > end_date)",
      [booking.vehicle_id, booking.id, booking.start_date, booking.end_date],
    );

    if (overlapResult.rowCount > 0) {
      await client.query(
        "update payments set metadata_json = jsonb_set(metadata_json, '{overlap_review}', 'true'::jsonb, true), updated_at = now() where id = $1",
        [payment.id],
      );
      await client.query("commit");
      await writeAuditLog({
        userId: "system",
        action: "PAYMENT_DEPOSIT_OVERLAP_REVIEW",
        entityType: "booking",
        entityId: booking.id,
        details: {
          paymentId: payment.id,
          orderId: input.orderId,
          transactionId: input.transactionId,
          source: input.source,
        },
      });
      return { ok: false, reason: "overlap", bookingId: booking.id };
    }

    await client.query("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
      booking.id,
    ]);

    await client.query("commit");

    await writeAuditLog({
      userId: "system",
      action: "PAYMENT_DEPOSIT_CONFIRMED_WIPAY",
      entityType: "booking",
      entityId: booking.id,
      details: {
        paymentId: payment.id,
        orderId: input.orderId,
        transactionId: input.transactionId,
        source: input.source,
      },
    });

    if (!receiptSent) {
      try {
        const detailResult = await dbQuery<{
          id: string;
          start_date: string;
          end_date: string;
          pickup_location: string;
          pricing_json: Record<string, unknown> | null;
          customer_name: string;
          customer_email: string;
          vehicle_make: string;
          vehicle_model: string;
          vehicle_year: number;
          daily_rate_cents: number;
          deposit_cents: number;
        }>(
          "select b.id, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
          [booking.id],
        );

        if (detailResult.rowCount > 0) {
          const detail = detailResult.rows[0];
          const depositValue = Number(
            (detail.pricing_json as Record<string, unknown> | null)?.deposit_cents ??
              detail.deposit_cents,
          );
          await sendDepositReceiptEmail({
            bookingId: detail.id,
            customerEmail: detail.customer_email,
            customerName: detail.customer_name,
            vehicleLabel: `${detail.vehicle_year} ${detail.vehicle_make} ${detail.vehicle_model}`.trim(),
            startDate: detail.start_date,
            endDate: detail.end_date,
            pickupLocation: detail.pickup_location,
            dailyRate: Number(detail.daily_rate_cents || 0),
            deposit: depositValue,
            paidToDate: depositValue,
          });

          await dbQuery(
            "update payments set metadata_json = jsonb_set(metadata_json, '{receipt_email_sent}', 'true'::jsonb, true), updated_at = now() where id = $1",
            [payment.id],
          );
        }
      } catch (error) {
        logError("wipay_deposit_receipt_email_failed", error, {
          bookingId: booking.id,
          paymentId: payment.id,
          orderId: input.orderId,
          transactionId: input.transactionId,
          source: input.source,
        });
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
    return { ok: false };
  } finally {
    client.release();
  }
}
