import { NextResponse } from "next/server";

import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { CustomerBlockedError, upsertCustomerForBooking } from "@/lib/customers";
import { normalizeLegalIdType } from "@/lib/customers/legalId";
import { isPublicVehicleUnavailableForWindow } from "@/lib/publicVehicles";
import { createBookingAccessToken, hashBookingAccessToken } from "@/lib/bookings/privateAccess";
import { normalizePromoInputCode, upsertPromoRedemption, validatePromoForBooking } from "@/lib/promos";
import { computeBookingPricing, parsePaymentOptionInput } from "@/lib/payments/pricing";
import { extractUploadcareFileId, uploadDataUrlToUploadcareFileId } from "@/lib/uploads/uploadcare";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME_ONLY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeTime(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return TIME_ONLY_REGEX.test(trimmed) ? trimmed : fallback;
}

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function parseOptionalDate(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return isISODate(normalized) ? normalized : null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const vehicleId = normalizeText(body?.vehicleId);
  const fullName = normalizeText(body?.fullName);
  const emailInput = normalizeText(body?.email);
  const phoneInput = normalizeText(body?.phone);
  const startDate = normalizeText(body?.startDate);
  const endDate = normalizeText(body?.endDate);
  const pickupLocation = normalizeText(body?.pickupLocation);
  const dropoffLocation = normalizeText(body?.dropoffLocation) || pickupLocation;
  const pickupTime = normalizeTime(body?.pickupTime, "11:00");
  const dropoffTime = normalizeTime(body?.dropoffTime, "11:00");
  const pickupLocationTextSnapshot =
    normalizeText(body?.pickupLocationTextSnapshot) || pickupLocation;
  const dropoffLocationTextSnapshot =
    normalizeText(body?.dropoffLocationTextSnapshot) || dropoffLocation;
  const customerId = normalizeText(body?.customerId);
  const pickupLocationId = normalizeText(body?.pickupLocationId);
  const dropoffLocationId = normalizeText(body?.dropoffLocationId);
  const insuranceSelected = body?.insuranceSelected === true;
  const insurancePricePerDayCents = Math.max(0, parseAmount(body?.insurancePricePerDayCents) ?? 0);
  const insurancePlanId = normalizeText(body?.insurancePlanId);
  const couponCode = normalizePromoInputCode(normalizeText(body?.couponCode));
  const paymentOptionInput = parsePaymentOptionInput(body?.paymentOption);
  const paymentOption = paymentOptionInput ?? "DEPOSIT";
  const customPaymentAmountCents = parseAmount(body?.customPaymentAmountCents);
  const driversLicenseNumber = normalizeText(body?.driversLicenseNumber) || normalizeText(body?.legalIdNumber);
  const driversLicenseExpirationDate = parseOptionalDate(body?.driversLicenseExpirationDate);
  const signatureDataUrl = normalizeText(body?.signatureDataUrl);
  const customerProfile =
    body?.customerProfile && typeof body.customerProfile === "object"
      ? (body.customerProfile as Record<string, unknown>)
      : null;
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber = normalizeText(body?.legalIdNumber) || driversLicenseNumber;
  const legalIdImageReference =
    normalizeText(body?.legalIdImageUploadToken) || normalizeText(body?.legalIdImageUrl);
  const driversLicenseFileId = extractUploadcareFileId(legalIdImageReference);

  if (!UUID_REGEX.test(vehicleId)) {
    return NextResponse.json({ error: "Invalid vehicleId" }, { status: 400 });
  }
  if (customerId && !UUID_REGEX.test(customerId)) {
    return NextResponse.json({ error: "Invalid customerId" }, { status: 400 });
  }
  if (!isNonEmptyString(fullName, 2)) {
    return NextResponse.json({ error: "Invalid fullName" }, { status: 400 });
  }
  if (emailInput && !isEmail(emailInput)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (phoneInput && !isNonEmptyString(phoneInput, 7)) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  if (!isISODate(startDate) || !isISODate(endDate)) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (!isNonEmptyString(pickupLocation, 3)) {
    return NextResponse.json({ error: "Invalid pickupLocation" }, { status: 400 });
  }
  if (!isNonEmptyString(dropoffLocation, 3)) {
    return NextResponse.json({ error: "Invalid dropoffLocation" }, { status: 400 });
  }
  if (!legalIdType) {
    return NextResponse.json({ error: "Valid legalIdType is required" }, { status: 400 });
  }
  if (!isNonEmptyString(legalIdNumber, 4) || !isNonEmptyString(driversLicenseNumber, 4)) {
    return NextResponse.json({ error: "Valid legalIdNumber is required" }, { status: 400 });
  }
  if (!driversLicenseFileId) {
    return NextResponse.json({ error: "Driver's license image upload is required" }, { status: 400 });
  }
  if (!signatureDataUrl || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(signatureDataUrl)) {
    return NextResponse.json({ error: "Signature is required" }, { status: 400 });
  }
  if (pickupLocationId && !UUID_REGEX.test(pickupLocationId)) {
    return NextResponse.json({ error: "Invalid pickupLocationId" }, { status: 400 });
  }
  if (dropoffLocationId && !UUID_REGEX.test(dropoffLocationId)) {
    return NextResponse.json({ error: "Invalid dropoffLocationId" }, { status: 400 });
  }
  if (insurancePlanId && !UUID_REGEX.test(insurancePlanId)) {
    return NextResponse.json({ error: "Invalid insurancePlanId" }, { status: 400 });
  }
  if (body && body.paymentOption !== undefined && paymentOptionInput === null) {
    return NextResponse.json({ error: "Invalid payment option." }, { status: 400 });
  }

  const start = dateOnlyUtc(startDate);
  const end = dateOnlyUtc(endDate);
  const today = dateOnlyUtc(new Date());

  if (!start || !end || !today) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }

  if (start < today) {
    return NextResponse.json({ error: "startDate must be today or later" }, { status: 400 });
  }
  if (!(end > start)) {
    return NextResponse.json({ error: "endDate must be after startDate" }, { status: 400 });
  }

  // Pricing/UI treats end_date as inclusive (e.g. 3/19 -> 3/20 is 2 days).
  const days = calcDaysInclusive(start, end);
  if (days <= 0) {
    return NextResponse.json({ error: "Invalid rental duration" }, { status: 400 });
  }

  const startAt = new Date(`${startDate}T${pickupTime}:00`);
  const endAt = new Date(`${endDate}T${dropoffTime}:00`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return NextResponse.json(
      { error: "Return date and time must be later than pickup date and time" },
      { status: 400 },
    );
  }

  const normalizedEmail = emailInput ? emailInput.toLowerCase() : `no-email+${Date.now()}@curated.local`;
  const normalizedPhone = phoneInput || "0000000";
  const insuranceTotalCents = insuranceSelected ? insurancePricePerDayCents * days : 0;

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const vehicleResult = await client.query(
      "select id, make, model, year, daily_rate_cents, deposit_cents from vehicles where id = $1 and status <> 'INACTIVE'",
      [vehicleId],
    );

    if (vehicleResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const isUnavailable = await isPublicVehicleUnavailableForWindow(vehicleId, {
      pickupDate: startDate,
      dropoffDate: endDate,
      pickupTime,
      dropoffTime,
    });

    if (isUnavailable) {
      await client.query("rollback");
      return NextResponse.json({ error: "Vehicle unavailable for selected dates" }, { status: 409 });
    }

    const linkedCustomerId = customerId || null;
    if (linkedCustomerId) {
      const linkedCustomerResult = (await client.query(
        "select drivers_license_number from customers where id = $1 limit 1",
        [linkedCustomerId],
      )) as { rowCount: number; rows: Array<{ drivers_license_number: string | null }> };

      if (linkedCustomerResult.rowCount === 0) {
        await client.query("rollback");
        return NextResponse.json({ error: "Invalid customer reference." }, { status: 400 });
      }

      const linkedLicense = normalizeText(linkedCustomerResult.rows[0]?.drivers_license_number);
      if (
        linkedLicense &&
        linkedLicense.toLowerCase() !== driversLicenseNumber.toLowerCase()
      ) {
        await client.query("rollback");
        return NextResponse.json({ error: "We couldn't verify your details." }, { status: 400 });
      }
    } else {
      const existingCustomerByLicense = (await client.query(
        "select id from customers where lower(coalesce(drivers_license_number, '')) = lower($1) limit 1",
        [driversLicenseNumber],
      )) as { rowCount: number; rows: Array<{ id: string }> };
      if (existingCustomerByLicense.rowCount > 0) {
        await client.query("rollback");
        return NextResponse.json(
          {
            error:
              "We couldn't verify your details. Use Returning Customer verification before continuing.",
          },
          { status: 400 },
        );
      }
    }

    const customerInput = {
      customerId: linkedCustomerId,
      fullName,
      email: normalizedEmail,
      phone: normalizedPhone,
      legalIdType,
      legalIdNumber,
      legalIdImageUrl: null,
      bookedAt: new Date().toISOString(),
    } as const;
    let customerUpsert;
    try {
      customerUpsert = await upsertCustomerForBooking(customerInput, { client });
    } catch (error) {
      if (error instanceof CustomerBlockedError) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "This customer profile is blocked from booking. Please contact support." },
          { status: 403 },
        );
      }
      throw error;
    }

    const firstName = normalizeText(customerProfile?.firstName) || fullName.split(/\s+/)[0] || "";
    const lastName =
      normalizeText(customerProfile?.lastName) ||
      fullName.split(/\s+/).slice(1).join(" ");
    const profileBirthday = parseOptionalDate(customerProfile?.birthday);
    const street = normalizeText(customerProfile?.street);
    const street2 = normalizeText(customerProfile?.street2);
    const city = normalizeText(customerProfile?.city);
    const state = normalizeText(customerProfile?.state);
    const zip = normalizeText(customerProfile?.zip);
    const country = normalizeText(customerProfile?.country);

    await client.query(
      "update customers set first_name = case when nullif($2, '') is not null then $2 else first_name end, last_name = case when nullif($3, '') is not null then $3 else last_name end, street = case when nullif($4, '') is not null then $4 else street end, street2 = case when nullif($5, '') is not null then $5 else street2 end, city = case when nullif($6, '') is not null then $6 else city end, state = case when nullif($7, '') is not null then $7 else state end, zip = case when nullif($8, '') is not null then $8 else zip end, country = case when nullif($9, '') is not null then $9 else country end, birthday = coalesce($10::date, birthday), drivers_license_number = case when nullif($11, '') is not null then $11 else drivers_license_number end where id = $1",
      [
        customerUpsert.customerId,
        firstName,
        lastName,
        street,
        street2,
        city,
        state,
        zip,
        country,
        profileBirthday,
        driversLicenseNumber,
      ],
    );

    const dailyRate = vehicleResult.rows[0].daily_rate_cents as number;
    const depositCents = vehicleResult.rows[0].deposit_cents as number;
    const pricingBeforePromo = computeBookingPricing({
      bookingId: "draft",
      bookingStatus: "PENDING_PAYMENT",
      startDate,
      endDate,
      dailyRate,
      deposit: depositCents,
      paymentOption,
      netPaidToDate: 0,
      insuranceSelected,
      insurancePricePerDay: insurancePricePerDayCents,
      insuranceTotal: insuranceTotalCents,
      promoCode: null,
      promoDiscount: 0,
    });
    const subtotalCents = pricingBeforePromo.subtotal;
    let promoId: string | null = null;
    let promoDiscountCents = 0;
    let promoAppliedCode: string | null = null;

    if (couponCode) {
      const promoValidation = await validatePromoForBooking({
        code: couponCode,
        vehicleId,
        startDate,
        endDate,
        subtotalCents,
        customerId: customerUpsert.customerId,
        customerEmail: normalizedEmail,
        client,
      });

      if (!promoValidation.ok) {
        await client.query("rollback");
        return NextResponse.json({ error: promoValidation.message }, { status: 400 });
      }

      promoId = promoValidation.promoId;
      promoDiscountCents = promoValidation.discountAmountCents;
      promoAppliedCode = promoValidation.code;
    }

    const pricingSummary = computeBookingPricing({
      bookingId: "draft",
      bookingStatus: "PENDING_PAYMENT",
      startDate,
      endDate,
      dailyRate,
      deposit: depositCents,
      paymentOption,
      netPaidToDate: 0,
      insuranceSelected,
      insurancePricePerDay: insurancePricePerDayCents,
      insuranceTotal: insuranceTotalCents,
      promoCode: promoAppliedCode,
      promoDiscount: promoDiscountCents,
    });
    const totalAfterDiscount = pricingSummary.total;
    const customAmount =
      paymentOption === "CUSTOM" ? Math.max(0, customPaymentAmountCents ?? 0) : null;

    if (paymentOption === "CUSTOM") {
      if (customAmount === null || customAmount <= 0 || customAmount > totalAfterDiscount) {
        await client.query("rollback");
        return NextResponse.json(
          { error: "Custom payment must be greater than 0 and not exceed amount due." },
          { status: 400 },
        );
      }
    }

    const bookingAccessToken = createBookingAccessToken();
    const bookingAccessTokenHash = hashBookingAccessToken(bookingAccessToken);

    const pricing = {
      daily_rate_cents: dailyRate,
      deposit_cents: depositCents,
      days: pricingSummary.days,
      base_total_cents: pricingSummary.baseTotal,
      subtotal_cents: pricingSummary.subtotal,
      insurance_selected: pricingSummary.insuranceSelected,
      insurance_price_per_day_cents: pricingSummary.insurancePricePerDay,
      insurance_total_cents: pricingSummary.insuranceTotal,
      promo_code: pricingSummary.promoCode,
      promo_code_id: promoId,
      promo_discount_cents: pricingSummary.discountTotal,
      discount_total_cents: pricingSummary.discountTotal,
      total_cents: pricingSummary.total,
      total_amount: pricingSummary.total,
      amount_due_cents: pricingSummary.amountDue,
      amount_paid: 0,
      balance_due: pricingSummary.balanceDue,
      payment_status: pricingSummary.paymentStatus,
      payment_option_selected: pricingSummary.paymentOption,
      custom_payment_amount_cents: customAmount,
      private_access_token_hash: bookingAccessTokenHash,
      currency: "JMD",
    };

    const bookingInsert = await client.query(
      "insert into bookings (vehicle_id, customer_id, start_date, end_date, start_at, end_at, pickup_time, dropoff_time, pickup_location, dropoff_location, pickup_location_id, dropoff_location_id, pickup_location_text_snapshot, dropoff_location_text_snapshot, insurance_selected, insurance_plan_id, insurance_price_per_day_cents, insurance_total_cents, payment_option, custom_payment_amount_cents, drivers_license_number, drivers_license_expiration_date, drivers_license_uploaded_at, signature_signed_at, status, pricing_json) values ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10, $11::uuid, $12::uuid, $13, $14, $15, $16::uuid, $17, $18, $19, $20, $21, $22::date, $23, $24, 'PENDING_PAYMENT', $25) returning id, status",
      [
        vehicleId,
        customerUpsert.customerId,
        startDate,
        endDate,
        startAt.toISOString(),
        endAt.toISOString(),
        pickupTime,
        dropoffTime,
        pickupLocation,
        dropoffLocation,
        pickupLocationId || null,
        dropoffLocationId || null,
        pickupLocationTextSnapshot,
        dropoffLocationTextSnapshot,
        insuranceSelected,
        insurancePlanId || null,
        insurancePricePerDayCents,
        insuranceTotalCents,
        paymentOption,
        customAmount,
        driversLicenseNumber,
        driversLicenseExpirationDate,
        new Date().toISOString(),
        signatureDataUrl ? new Date().toISOString() : null,
        pricing,
      ],
    );

    if (promoId && promoDiscountCents > 0) {
      await upsertPromoRedemption({
        bookingId: bookingInsert.rows[0].id as string,
        promoId,
        customerId: customerUpsert.customerId,
        customerEmail: normalizedEmail,
        discountAmountCents: promoDiscountCents,
        client,
      });
    }

    await client.query(
      "insert into booking_private_files (booking_id, document_type, storage_provider, storage_key, mime_type, metadata_json) values ($1, 'DRIVERS_LICENSE', 'UPLOADCARE_FILE_ID', $2, 'image/*', $3::jsonb)",
      [
        bookingInsert.rows[0].id,
        driversLicenseFileId,
        JSON.stringify({
          source: "public_booking_wizard",
          driversLicenseNumberTail: driversLicenseNumber.slice(-4),
        }),
      ],
    );

    if (signatureDataUrl) {
      const signatureFileId = await uploadDataUrlToUploadcareFileId(signatureDataUrl, {
        fileName: `booking-signature-${bookingInsert.rows[0].id}.png`,
      });
      await client.query(
        "insert into booking_private_files (booking_id, document_type, storage_provider, storage_key, mime_type, metadata_json) values ($1, 'SIGNATURE', 'UPLOADCARE_FILE_ID', $2, 'image/png', $3::jsonb)",
        [
          bookingInsert.rows[0].id,
          signatureFileId,
          JSON.stringify({
            source: "public_booking_wizard",
            capturedAt: new Date().toISOString(),
          }),
        ],
      );
    }

    await client.query("commit");

    try {
      if (!normalizedEmail.endsWith("@curated.local")) {
        const vehicle = vehicleResult.rows[0];
        await sendBookingCreatedEmail({
          bookingId: bookingInsert.rows[0].id,
          customerEmail: normalizedEmail,
          customerName: fullName,
          vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
          startDate,
          endDate,
          pickupLocation,
          dailyRate,
          deposit: depositCents,
          promoCode: promoAppliedCode,
          promoDiscount: promoDiscountCents,
        });
      }
    } catch (error) {
      logError("public_booking_email_failed", error, {
        bookingId: bookingInsert.rows[0]?.id,
        vehicleId,
        startDate,
        endDate,
      });
    }

    return NextResponse.json({
      bookingId: bookingInsert.rows[0].id,
      bookingAccessToken,
      status: bookingInsert.rows[0].status,
      promoApplied: Boolean(promoId),
    });
  } catch (error) {
    await client.query("rollback");
    logError("public_booking_create_failed", error, {
      vehicleId,
      startDate,
      endDate,
    });
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  } finally {
    client.release();
  }
}
