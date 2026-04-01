import { NextResponse } from "next/server";

import { sendBookingCreatedEmail } from "@/lib/notifications/email";
import { getDbPool } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { isEmail, isISODate, isNonEmptyString } from "@/lib/validators";
import { calcDaysInclusive, dateOnlyUtc } from "@/lib/payments/dateMath";
import { CustomerBlockedError, upsertCustomerForBooking } from "@/lib/customers";
import { normalizeCountryName, normalizeRegionForCountry } from "@/lib/jamaicaParishes";
import { normalizeLegalIdType } from "@/lib/customers/legalId";
import { isPublicVehicleUnavailableForWindow } from "@/lib/publicVehicles";
import {
  createBookingAccessToken,
  hashBookingAccessToken,
  hashBookingSubmissionKey,
} from "@/lib/bookings/privateAccess";
import {
  appendBookingLocationNote,
  inferBookingLocationType,
} from "@/lib/bookings/bookingLocations";
import { listActiveBookingLocationConfigs } from "@/lib/bookings/bookingLocationConfigStore";
import { toBookingLocationConfigSchemaError } from "@/lib/bookings/bookingLocationConfigStore";
import {
  buildBookingLocationSelectionPayload,
  normalizeBookingLocationFieldValuesInput,
  validateBookingLocationSelection,
} from "@/lib/bookings/locationConfigRuntime";
import {
  parseSafePrivateBookingImageDataUrl,
  MAX_BOOKING_PRIVATE_IMAGE_BYTES,
} from "@/lib/bookings/privateFiles";
import { normalizePromoInputCode } from "@/lib/promos";
import {
  computeBookingPricingFromStoredSnapshot,
  parsePaymentOptionInput,
} from "@/lib/payments/pricing";
import { buildQuotePricingSnapshot, QuotePricingError } from "@/lib/quotes/quotePricing";
import {
  categorizeTurnstileFailure,
  extractTurnstileToken,
  getClientIpFromRequest,
  verifyTurnstileToken,
} from "@/lib/security/turnstile";
import { extractUploadcareFileId } from "@/lib/uploads/uploadcare";

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
  const clientIp = getClientIpFromRequest(request);
  const turnstileToken = extractTurnstileToken(body, request);

  const turnstileResult = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: clientIp,
    expectedAction: "public_booking",
  });
  if (!turnstileResult.ok) {
    logWarn("api.public.bookings.turnstile_failed", {
      route: "/api/public/bookings",
      failureCategory: categorizeTurnstileFailure(turnstileResult.errorCodes),
      status: turnstileResult.status,
      ip: clientIp ?? "unknown",
    });
    return NextResponse.json({ error: turnstileResult.userMessage }, { status: turnstileResult.status });
  }

  const vehicleId = normalizeText(body?.vehicleId);
  const fullName = normalizeText(body?.fullName);
  const emailInput = normalizeText(body?.email);
  const phoneInput = normalizeText(body?.phone);
  const startDate = normalizeText(body?.startDate);
  const endDate = normalizeText(body?.endDate);
  const pickupLocationInput = normalizeText(body?.pickupLocation);
  const dropoffLocationInput = normalizeText(body?.dropoffLocation) || pickupLocationInput;
  const pickupTime = normalizeTime(body?.pickupTime, "11:00");
  const dropoffTime = normalizeTime(body?.dropoffTime, "11:00");
  const customerId = normalizeText(body?.customerId);
  const pickupLocationId = normalizeText(body?.pickupLocationId);
  const dropoffLocationId = normalizeText(body?.dropoffLocationId);
  const pickupLocationType =
    inferBookingLocationType({
      locationType: body?.pickupLocationType,
      label: body?.pickupLocationTextSnapshot ?? pickupLocationInput,
    }) ?? "OFFICE";
  const dropoffLocationType =
    inferBookingLocationType({
      locationType: body?.dropoffLocationType,
      label:
        body?.dropoffLocationTextSnapshot ?? dropoffLocationInput ?? pickupLocationInput,
    }) ?? pickupLocationType;
  const bookingLocationDetailsRaw =
    body?.bookingLocationDetails && typeof body.bookingLocationDetails === "object"
      ? (body.bookingLocationDetails as Record<string, unknown>)
      : null;
  const pickupLocationDetailsRaw =
    bookingLocationDetailsRaw?.pickup && typeof bookingLocationDetailsRaw.pickup === "object"
      ? (bookingLocationDetailsRaw.pickup as Record<string, unknown>)
      : null;
  const dropoffLocationDetailsRaw =
    bookingLocationDetailsRaw?.dropoff && typeof bookingLocationDetailsRaw.dropoff === "object"
      ? (bookingLocationDetailsRaw.dropoff as Record<string, unknown>)
      : null;
  const insuranceSelected = body?.insuranceSelected === true;
  const insurancePricePerDayCents = Math.max(0, parseAmount(body?.insurancePricePerDayCents) ?? 0);
  const insurancePlanId = normalizeText(body?.insurancePlanId);
  const couponCode = normalizePromoInputCode(normalizeText(body?.couponCode));
  const paymentOptionInput = parsePaymentOptionInput(body?.paymentOption);
  const paymentOption = paymentOptionInput ?? "DEPOSIT";
  const customPaymentAmountCents = parseAmount(body?.customPaymentAmountCents);
  const submissionKey = normalizeText(body?.submissionKey);
  const driversLicenseNumber = normalizeText(body?.driversLicenseNumber) || normalizeText(body?.legalIdNumber);
  const hasDriversLicenseNumber = isNonEmptyString(driversLicenseNumber, 4);
  const driversLicenseExpirationDate = parseOptionalDate(body?.driversLicenseExpirationDate);
  const signatureDataUrl = normalizeText(body?.signatureDataUrl);
  const customerProfile =
    body?.customerProfile && typeof body.customerProfile === "object"
      ? (body.customerProfile as Record<string, unknown>)
      : null;
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber = hasDriversLicenseNumber
    ? normalizeText(body?.legalIdNumber) || driversLicenseNumber
    : null;
  const legalIdImageReference =
    normalizeText(body?.legalIdImageUploadToken) || normalizeText(body?.legalIdImageUrl);
  const driversLicenseDataUrl = normalizeText(body?.driversLicenseDataUrl);
  const driversLicenseFileId = extractUploadcareFileId(legalIdImageReference);
  const parsedDriversLicenseImage = driversLicenseDataUrl
    ? parseSafePrivateBookingImageDataUrl(driversLicenseDataUrl)
    : null;
  const parsedSignatureImage = signatureDataUrl
    ? parseSafePrivateBookingImageDataUrl(signatureDataUrl)
    : null;
  const hasDriversLicenseDataUrl = Boolean(parsedDriversLicenseImage);

  if (!UUID_REGEX.test(vehicleId)) {
    return NextResponse.json({ error: "Invalid vehicleId" }, { status: 400 });
  }
  if (customerId && !UUID_REGEX.test(customerId)) {
    return NextResponse.json({ error: "Invalid customerId" }, { status: 400 });
  }
  if (!isNonEmptyString(fullName, 2)) {
    return NextResponse.json({ error: "Invalid fullName" }, { status: 400 });
  }
  if (!emailInput || !isEmail(emailInput)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (!phoneInput || !isNonEmptyString(phoneInput, 7)) {
    return NextResponse.json({ error: "Valid phone is required" }, { status: 400 });
  }
  if (!isISODate(startDate) || !isISODate(endDate)) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (hasDriversLicenseNumber && !legalIdType) {
    return NextResponse.json({ error: "Valid legalIdType is required" }, { status: 400 });
  }
  if (hasDriversLicenseNumber && !isNonEmptyString(legalIdNumber, 4)) {
    return NextResponse.json({ error: "Valid legalIdNumber is required" }, { status: 400 });
  }
  if (!signatureDataUrl) {
    return NextResponse.json({ error: "Signature is required" }, { status: 400 });
  }
  if (!parsedSignatureImage) {
    return NextResponse.json(
      {
        error: `Signature must be a supported image under ${Math.floor(
          MAX_BOOKING_PRIVATE_IMAGE_BYTES / (1024 * 1024),
        )} MB.`,
      },
      { status: 400 },
    );
  }
  if (driversLicenseDataUrl && !parsedDriversLicenseImage) {
    return NextResponse.json(
      {
        error: `Driver's license upload must be a supported image under ${Math.floor(
          MAX_BOOKING_PRIVATE_IMAGE_BYTES / (1024 * 1024),
        )} MB.`,
      },
      { status: 400 },
    );
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
  if (!isNonEmptyString(submissionKey, 16)) {
    return NextResponse.json({ error: "Invalid submission key." }, { status: 400 });
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
  if (calcDaysInclusive(start, end) <= 0) {
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

  const normalizedEmail = emailInput.toLowerCase();
  const normalizedPhone = phoneInput;
  const submissionKeyHash = hashBookingSubmissionKey(submissionKey);
  const bookingAccessToken = createBookingAccessToken(submissionKey);
  const bookingAccessTokenHash = hashBookingAccessToken(bookingAccessToken);

  const pool = getDbPool();
  let bookingLocationConfigs;
  try {
    bookingLocationConfigs = await listActiveBookingLocationConfigs(pool);
  } catch (error) {
    const schemaError = toBookingLocationConfigSchemaError(error);
    if (schemaError) {
      return NextResponse.json(
        { error: schemaError.message, code: schemaError.code },
        { status: schemaError.status },
      );
    }
    throw error;
  }
  const locationSelection = buildBookingLocationSelectionPayload({
    configs: bookingLocationConfigs,
    pickupTypeKey: pickupLocationType,
    dropoffTypeKey: dropoffLocationType,
    pickupLocationId: pickupLocationId || null,
    dropoffLocationId: dropoffLocationId || null,
    pickupValues: normalizeBookingLocationFieldValuesInput(pickupLocationDetailsRaw?.values, {
      address:
        pickupLocationType === "CUSTOM_ADDRESS"
          ? normalizeText(body?.pickupLocationTextSnapshot) || pickupLocationInput || null
          : normalizeText(pickupLocationDetailsRaw?.address) || null,
      flight_date:
        pickupLocationType === "AIRPORT"
          ? parseOptionalDate(pickupLocationDetailsRaw?.flightDate) ?? startDate
          : null,
      flight_time:
        pickupLocationType === "AIRPORT"
          ? normalizeTime(pickupLocationDetailsRaw?.flightTime, pickupTime)
          : null,
      flight_number:
        pickupLocationType === "AIRPORT"
          ? normalizeText(pickupLocationDetailsRaw?.flightNumber) || null
          : null,
      airline:
        pickupLocationType === "AIRPORT"
          ? normalizeText(pickupLocationDetailsRaw?.airline) || null
          : null,
    }),
    dropoffValues: normalizeBookingLocationFieldValuesInput(dropoffLocationDetailsRaw?.values, {
      address:
        dropoffLocationType === "CUSTOM_ADDRESS"
          ? normalizeText(body?.dropoffLocationTextSnapshot) || dropoffLocationInput || null
          : normalizeText(dropoffLocationDetailsRaw?.address) || null,
      flight_date:
        dropoffLocationType === "AIRPORT"
          ? parseOptionalDate(dropoffLocationDetailsRaw?.flightDate) ?? endDate
          : null,
      flight_time:
        dropoffLocationType === "AIRPORT"
          ? normalizeTime(dropoffLocationDetailsRaw?.flightTime, dropoffTime)
          : null,
      flight_number:
        dropoffLocationType === "AIRPORT"
          ? normalizeText(dropoffLocationDetailsRaw?.flightNumber) || null
          : null,
      airline:
        dropoffLocationType === "AIRPORT"
          ? normalizeText(dropoffLocationDetailsRaw?.airline) || null
          : null,
    }),
    context: {
      pickupDate: startDate,
      pickupTime,
      dropoffDate: endDate,
      dropoffTime,
    },
  });
  const pickupLocationError = validateBookingLocationSelection(
    locationSelection.pickupConfig,
    "pickup",
    locationSelection.pickupValues,
  );
  if (pickupLocationError) {
    return NextResponse.json({ error: pickupLocationError }, { status: 400 });
  }
  const dropoffLocationError = validateBookingLocationSelection(
    locationSelection.dropoffConfig,
    "dropoff",
    locationSelection.dropoffValues,
  );
  if (dropoffLocationError) {
    return NextResponse.json({ error: dropoffLocationError }, { status: 400 });
  }
  const pickupLocationTextSnapshot = locationSelection.pickupLocationTextSnapshot;
  const dropoffLocationTextSnapshot = locationSelection.dropoffLocationTextSnapshot;
  const pickupLocation = pickupLocationTextSnapshot;
  const dropoffLocation = dropoffLocationTextSnapshot;
  const bookingLocationDetails = locationSelection.details;
  const deliverySelected =
    body?.deliverySelected === true ||
    locationSelection.pickupValues.address !== null ||
    locationSelection.dropoffValues.address !== null;
  const deliveryZoneLabel =
    normalizeText(body?.deliveryZoneLabel) ||
    [pickupLocationTextSnapshot, dropoffLocationTextSnapshot].filter(Boolean).join(" → ");
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [submissionKeyHash]);

    const existingSubmissionResult = (await client.query(
      "select id, status from bookings where pricing_json->>'public_submit_key_hash' = $1 order by created_at desc limit 1",
      [submissionKeyHash],
    )) as { rows: Array<{ id: string; status: string }> };
    const existingSubmission = existingSubmissionResult.rows[0] ?? null;
    if (existingSubmission) {
      await client.query("rollback");
      return NextResponse.json({
        bookingId: existingSubmission.id,
        bookingAccessToken,
        status: existingSubmission.status,
        duplicate: true,
      });
    }

    const vehicleResult = await client.query(
      "select id, make, model, year from vehicles where id = $1 and upper(coalesce(status, '')) not in ('INACTIVE', 'UNAVAILABLE', 'MAINTENANCE')",
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
        hasDriversLicenseNumber &&
        linkedLicense &&
        linkedLicense.toLowerCase() !== driversLicenseNumber.toLowerCase()
      ) {
        await client.query("rollback");
        return NextResponse.json({ error: "We couldn't verify your details." }, { status: 400 });
      }
    } else if (hasDriversLicenseNumber) {
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
      legalIdType: hasDriversLicenseNumber ? legalIdType : undefined,
      legalIdNumber: hasDriversLicenseNumber ? legalIdNumber : undefined,
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
    const regionInput =
      normalizeText(customerProfile?.parish) || normalizeText(customerProfile?.state);
    const country = normalizeCountryName(customerProfile?.country);
    const region = normalizeRegionForCountry(regionInput, country);

    await client.query(
      "update customers set first_name = case when nullif($2, '') is not null then $2 else first_name end, last_name = case when nullif($3, '') is not null then $3 else last_name end, street = case when nullif($4, '') is not null then $4 else street end, street2 = case when nullif($5, '') is not null then $5 else street2 end, city = case when nullif($6, '') is not null then $6 else city end, state = case when nullif($7, '') is not null then $7 else state end, zip = null, country = case when nullif($8, '') is not null then $8 else country end, birthday = coalesce($9::date, birthday), drivers_license_number = case when nullif($10, '') is not null then $10 else drivers_license_number end where id = $1",
      [
        customerUpsert.customerId,
        firstName,
        lastName,
        street,
        street2,
        city,
        region,
        country,
        profileBirthday,
        driversLicenseNumber,
      ],
    );

    const quoteSnapshot = await buildQuotePricingSnapshot(
      {
        vehicleId,
        startAt,
        endAt,
        insuranceEnabled: insuranceSelected,
        insurancePlanId: insurancePlanId || null,
        promoCode: couponCode,
        customerEmail: normalizedEmail,
        deliverySelected,
        deliveryZoneLabel: deliveryZoneLabel || null,
      },
      { client },
    );
    const pricingSummary = computeBookingPricingFromStoredSnapshot({
      bookingId: "draft",
      bookingStatus: "PENDING_PAYMENT",
      startDate,
      endDate,
      pricing: quoteSnapshot.pricingJson,
      paymentOption,
      netPaidToDate: 0,
      promoCode: quoteSnapshot.promoCode,
      promoDiscount: quoteSnapshot.summary.discountTotalCents,
      insuranceSelected: quoteSnapshot.insuranceEnabled,
      insurancePricePerDay: Number(
        quoteSnapshot.pricingJson.insurance_price_per_day_cents ?? insurancePricePerDayCents,
      ),
      insuranceTotal: quoteSnapshot.summary.insuranceTotalCents,
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

    const driversLicenseUploadedAt = driversLicenseFileId || hasDriversLicenseDataUrl
      ? new Date().toISOString()
      : null;

    const pricingBase = {
      ...quoteSnapshot.pricingJson,
      days: pricingSummary.days,
      customer_name_snapshot: fullName,
      customer_email_snapshot: normalizedEmail,
      customer_phone_snapshot: phoneInput,
      insurance_plan_id: quoteSnapshot.insurancePlanId,
      promo_code_id: quoteSnapshot.promoId,
      base_total_cents: pricingSummary.baseTotal,
      extra_fees_cents: pricingSummary.extraFeesTotal,
      subtotal_cents: pricingSummary.subtotal,
      promo_code: pricingSummary.promoCode,
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
      public_submit_key_hash: submissionKeyHash,
      private_access_token_hash: bookingAccessTokenHash,
      currency: String(quoteSnapshot.pricingJson.currency ?? "JMD"),
    };
    const pricing = appendBookingLocationNote(pricingBase, bookingLocationDetails);

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
        quoteSnapshot.insuranceEnabled,
        quoteSnapshot.insurancePlanId,
        pricingSummary.insurancePricePerDay,
        pricingSummary.insuranceTotal,
        paymentOption,
        customAmount,
        hasDriversLicenseNumber ? driversLicenseNumber : null,
        driversLicenseExpirationDate,
        driversLicenseUploadedAt,
        signatureDataUrl ? new Date().toISOString() : null,
        pricing,
      ],
    );

    if (hasDriversLicenseDataUrl) {
      await client.query(
        "insert into booking_private_files (booking_id, document_type, storage_provider, storage_key, mime_type, metadata_json) values ($1, 'DRIVERS_LICENSE', 'DATA_URL', $2, $3, $4::jsonb)",
        [
          bookingInsert.rows[0].id,
          parsedDriversLicenseImage?.normalizedDataUrl,
          parsedDriversLicenseImage?.mimeType || "image/jpeg",
          JSON.stringify({
            source: "public_booking_wizard",
            fallback: "inline_data_url",
            driversLicenseNumberTail: hasDriversLicenseNumber ? driversLicenseNumber.slice(-4) : null,
          }),
        ],
      );
    } else if (driversLicenseFileId) {
      await client.query(
        "insert into booking_private_files (booking_id, document_type, storage_provider, storage_key, mime_type, metadata_json) values ($1, 'DRIVERS_LICENSE', 'UPLOADCARE_FILE_ID', $2, null, $3::jsonb)",
        [
          bookingInsert.rows[0].id,
          driversLicenseFileId,
          JSON.stringify({
            source: "public_booking_wizard",
            driversLicenseNumberTail: hasDriversLicenseNumber ? driversLicenseNumber.slice(-4) : null,
          }),
        ],
      );
    }

    if (signatureDataUrl) {
      await client.query(
        "insert into booking_private_files (booking_id, document_type, storage_provider, storage_key, mime_type, metadata_json) values ($1, 'SIGNATURE', 'DATA_URL', $2, $3, $4::jsonb)",
        [
          bookingInsert.rows[0].id,
          parsedSignatureImage.normalizedDataUrl,
          parsedSignatureImage.mimeType,
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
          dailyRate: pricingSummary.dailyRate,
          deposit: pricingSummary.deposit,
          promoCode: quoteSnapshot.promoCode,
          promoDiscount: quoteSnapshot.summary.discountTotalCents,
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
      promoApplied: Boolean(quoteSnapshot.promoId),
    });
  } catch (error) {
    await client.query("rollback");
    if (error instanceof QuotePricingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
