#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

import { hashSync } from "bcryptjs";
import dotenv from "dotenv";
import { Pool } from "pg";

type E2EFixtures = {
  runId: string;
  createdAt: string;
  adminUser: {
    id: string | null;
    email: string | null;
    createdBySeed: boolean;
  };
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    label: string;
  };
  bookingLocations: {
    pickup: { id: string; label: string };
    dropoff: { id: string; label: string };
  };
  customer: {
    id: string;
    email: string;
  };
  insurancePlan: {
    id: string;
  };
  depreciationProfile: {
    id: string;
  };
  maintenance: {
    recordId: string;
    title: string;
    scheduledDate: string;
    blockoutReason: string;
    blockoutId: string | null;
  };
  document: {
    id: string | null;
  };
  bookings: {
    unpaidDeposit: BookingFixtureRef;
    partialBalance: BookingFixtureRef;
    fullyPaid: BookingFixtureRef;
    refundRequired: BookingFixtureRef;
    refundableWipay: BookingFixtureRef;
  };
  promoCodes: {
    active: PromoFixtureRef;
    scheduled: PromoFixtureRef;
    expired: PromoFixtureRef;
    limitReached: PromoFixtureRef;
    inactive: PromoFixtureRef;
    vehicleRestricted: PromoFixtureRef;
    blackoutRestricted: PromoFixtureRef;
    perCustomerLimited: PromoFixtureRef;
    reconstructedHistory: PromoFixtureRef;
    fillers: PromoFixtureRef[];
  };
};

type PromoFixtureRef = {
  id: string;
  publicId: string;
  code: string;
};

type PaymentFixtureRef = {
  id: string;
  publicId: string;
  amountCents: number;
  provider: "MANUAL" | "WIPAY";
  status: "DEPOSIT_PAID" | "REFUNDED";
  paymentType: string | null;
};

type BookingFixtureRef = {
  id: string;
  publicId: string;
  status: string;
  totalCents: number;
  depositCents: number;
  paymentOption: string;
  paymentStatus: string;
  paidToDate: number;
  balanceDue: number;
  payments: {
    deposit?: PaymentFixtureRef;
    manual?: PaymentFixtureRef;
    balance?: PaymentFixtureRef;
    refund?: PaymentFixtureRef;
    wipay?: PaymentFixtureRef;
  };
};

const ARTIFACTS_DIR = path.join(process.cwd(), ".artifacts");
const FIXTURES_PATH = path.join(ARTIFACTS_DIR, "e2e-fixtures.json");

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function normalizeDatabaseUrl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const params = url.searchParams;
    const libpqCompat = params.get("uselibpqcompat") === "true";

    if (libpqCompat) {
      if (!params.get("sslmode")) params.set("sslmode", "require");
      url.search = params.toString();
      return url.toString();
    }

    const sslmode = (params.get("sslmode") ?? "").toLowerCase();
    if (!sslmode) {
      params.set("sslmode", "verify-full");
    } else if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      params.set("sslmode", "verify-full");
    }

    url.search = params.toString();
    return url.toString();
  } catch {
    return connectionString;
  }
}

function createRunId() {
  const time = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `tour${time}${random}`;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

function buildPricingSnapshot(input: {
  dailyRateCents: number;
  days: number;
  depositCents: number;
  paidToDate?: number;
  paymentOption?: "DEPOSIT" | "FULL" | "CUSTOM" | "NONE";
  promoCode?: string | null;
  promoDiscountCents?: number;
  insuranceSelected?: boolean;
  insurancePricePerDayCents?: number;
}) {
  const paymentOption = input.paymentOption ?? "DEPOSIT";
  const paidToDate = Math.max(0, Number(input.paidToDate ?? 0));
  const insuranceSelected = input.insuranceSelected === true;
  const insurancePricePerDayCents = insuranceSelected
    ? Math.max(0, Number(input.insurancePricePerDayCents ?? 0))
    : 0;
  const insuranceTotalCents = insuranceSelected
    ? insurancePricePerDayCents * input.days
    : 0;
  const baseTotalCents = input.dailyRateCents * input.days;
  const subtotalCents = baseTotalCents + insuranceTotalCents;
  const promoDiscountCents = Math.max(0, Number(input.promoDiscountCents ?? 0));
  const totalCents = Math.max(0, subtotalCents - promoDiscountCents);
  const balanceDueCents = Math.max(0, totalCents - paidToDate);
  const paymentStatus =
    balanceDueCents === 0 && totalCents > 0
      ? "PAID_IN_FULL"
      : paidToDate > 0
        ? "DEPOSIT_PAID"
        : paymentOption === "NONE"
          ? "DUE_ON_PICKUP"
          : "UNPAID";

  return {
    daily_rate_cents: input.dailyRateCents,
    base_total_cents: baseTotalCents,
    subtotal_cents: subtotalCents,
    total_cents: totalCents,
    deposit_cents: input.depositCents,
    deposit_required_cents: input.depositCents,
    amount_paid: paidToDate,
    paid_to_date: paidToDate,
    balance_due: balanceDueCents,
    payment_status: paymentStatus,
    payment_option_selected: paymentOption,
    promo_code: input.promoCode ?? null,
    promo_discount_cents: promoDiscountCents,
    insurance_selected: insuranceSelected,
    insurance_price_per_day_cents: insurancePricePerDayCents,
    insurance_total_cents: insuranceTotalCents,
  };
}

async function insertPromoCode(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  input: {
    code: string;
    isActive?: boolean;
    discountType?: "PERCENT" | "FIXED";
    applyScope?: "OVERALL_TOTAL" | "DAYS_TOTAL";
    discountValue?: number;
    minSubtotalCents?: number | null;
    maxRedemptions?: number | null;
    maxRedemptionsPerCustomer?: number | null;
    startAt?: string | null;
    endAt?: string | null;
    allowedVehicleIds?: string[];
    excludedVehicleIds?: string[];
    blackoutDates?: string[];
    createdBy?: string | null;
    createdAt: string;
  },
) {
  const result = await client.query(
    `insert into promo_codes (
       code,
       is_active,
       discount_type,
       apply_scope,
       discount_value,
       min_subtotal_cents,
       max_redemptions,
       max_redemptions_per_customer,
       start_at,
       end_at,
       allowed_vehicle_ids_json,
       excluded_vehicle_ids_json,
       blackout_dates_json,
       created_by,
       created_at,
       updated_at
     )
     values (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9::timestamptz,
       $10::timestamptz,
       $11::jsonb,
       $12::jsonb,
       $13::jsonb,
       $14::uuid,
       $15::timestamptz,
       $15::timestamptz
     )
     returning id, public_id, code`,
    [
      input.code,
      input.isActive ?? true,
      input.discountType ?? "FIXED",
      input.applyScope ?? "OVERALL_TOTAL",
      input.discountValue ?? 5000,
      input.minSubtotalCents ?? null,
      input.maxRedemptions ?? null,
      input.maxRedemptionsPerCustomer ?? null,
      input.startAt ?? null,
      input.endAt ?? null,
      JSON.stringify(input.allowedVehicleIds ?? []),
      JSON.stringify(input.excludedVehicleIds ?? []),
      JSON.stringify(input.blackoutDates ?? []),
      input.createdBy ?? null,
      input.createdAt,
    ],
  );

  return {
    id: String(result.rows[0]?.id ?? ""),
    publicId: String(result.rows[0]?.public_id ?? ""),
    code: String(result.rows[0]?.code ?? input.code),
  } satisfies PromoFixtureRef;
}

async function insertPromoBooking(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  input: {
    vehicleId: string;
    customerId: string;
    pickupLocation: string;
    dropoffLocation?: string | null;
    startDate: string;
    endDate: string;
    status: string;
    pricingJson: Record<string, unknown>;
    createdAt: string;
  },
) {
  const result = await client.query(
    `insert into bookings (
       vehicle_id,
       customer_id,
       start_date,
       end_date,
       pickup_location,
       dropoff_location,
       status,
       pricing_json,
       created_at,
       updated_at
     )
     values ($1::uuid, $2::uuid, $3::date, $4::date, $5, $6, $7, $8::jsonb, $9::timestamptz, $9::timestamptz)
     returning id, public_id`,
    [
      input.vehicleId,
      input.customerId,
      input.startDate,
      input.endDate,
      input.pickupLocation,
      input.dropoffLocation ?? null,
      input.status,
      JSON.stringify(input.pricingJson),
      input.createdAt,
    ],
  );

  return {
    id: String(result.rows[0]?.id ?? ""),
    publicId: String(result.rows[0]?.public_id ?? ""),
  };
}

async function insertPayment(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  input: {
    bookingId: string;
    provider: "MANUAL" | "WIPAY";
    amountCents: number;
    status: "DEPOSIT_PAID" | "REFUNDED";
    providerRef: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  },
) {
  const result = await client.query(
    `insert into payments (
       booking_id,
       provider,
       deposit_amount_cents,
       currency,
       status,
       provider_ref,
       metadata_json,
       created_at,
       updated_at
     )
     values ($1::uuid, $2, $3, 'JMD', $4, $5, $6::jsonb, $7::timestamptz, $7::timestamptz)
     returning id, public_id`,
    [
      input.bookingId,
      input.provider,
      input.amountCents,
      input.status,
      input.providerRef,
      JSON.stringify(input.metadata ?? {}),
      input.createdAt,
    ],
  );

  return {
    id: String(result.rows[0]?.id ?? ""),
    publicId: String(result.rows[0]?.public_id ?? ""),
    amountCents: input.amountCents,
    provider: input.provider,
    status: input.status,
    paymentType:
      typeof input.metadata?.payment_type === "string" ? input.metadata.payment_type : null,
  } satisfies PaymentFixtureRef;
}

function buildBookingFixtureRef(input: {
  booking: { id: string; publicId: string };
  status: string;
  pricingJson: Record<string, unknown>;
  paidToDate: number;
  payments?: BookingFixtureRef["payments"];
}) {
  return {
    id: input.booking.id,
    publicId: input.booking.publicId,
    status: input.status,
    totalCents: Number(input.pricingJson.total_cents ?? 0),
    depositCents: Number(
      input.pricingJson.deposit_required_cents ?? input.pricingJson.deposit_cents ?? 0,
    ),
    paymentOption: String(input.pricingJson.payment_option_selected ?? "DEPOSIT"),
    paymentStatus: String(input.pricingJson.payment_status ?? "UNPAID"),
    paidToDate: input.paidToDate,
    balanceDue: Math.max(0, Number(input.pricingJson.total_cents ?? 0) - input.paidToDate),
    payments: input.payments ?? {},
  } satisfies BookingFixtureRef;
}

async function insertPromoRedemption(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  input: {
    promoCodeId: string;
    bookingId: string;
    customerId: string;
    customerEmail: string;
    discountAmountCents: number;
    createdAt: string;
  },
) {
  await client.query(
    `insert into promo_redemptions (
       promo_code_id,
       booking_id,
       customer_id,
       customer_email,
       discount_amount_cents,
       created_at
     )
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::timestamptz)`,
    [
      input.promoCodeId,
      input.bookingId,
      input.customerId,
      input.customerEmail,
      input.discountAmountCents,
      input.createdAt,
    ],
  );
}

async function insertPromoRedemptionEvent(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  input: {
    promoCodeId: string;
    bookingId: string;
    customerId: string;
    customerEmail: string;
    discountAmountCents: number;
    eventType: "REDEEMED" | "REVERSED";
    eventAt: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `insert into promo_redemption_events (
       promo_code_id,
       booking_id,
       customer_id,
       customer_email,
       discount_amount_cents,
       event_type,
       event_at,
       metadata_json
     )
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
    [
      input.promoCodeId,
      input.bookingId,
      input.customerId,
      input.customerEmail,
      input.discountAmountCents,
      input.eventType,
      input.eventAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function tableHasColumn(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, tableName: string, columnName: string) {
  const result = await client.query(
    `select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2
    ) as exists`,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

async function main() {
  loadEnv();

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is not set");

  const runId = createRunId();
  const now = new Date();
  const scheduledDate = addDays(now, 3);
  const blockoutStart = new Date(scheduledDate);
  blockoutStart.setHours(9, 0, 0, 0);
  const blockoutEnd = new Date(scheduledDate);
  blockoutEnd.setHours(17, 0, 0, 0);
  const purchaseDate = addDays(now, -365 * 2);

  const vehicleMake = "E2E";
  const vehicleModel = `Tour ${runId.slice(-6).toUpperCase()}`;
  const vehicleYear = now.getFullYear();
  const pickupLabel = `E2E Pickup ${runId}`;
  const dropoffLabel = `E2E Dropoff ${runId}`;
  const customerEmail = `tour+${runId}@example.com`;
  const maintenanceTitle = `E2E Seed Maintenance ${runId}`;
  const maintenanceReason = `E2E maintenance blockout ${runId}`;

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const client = await pool.connect();

  try {
    await client.query("begin");

    const adminUserResult = await client.query(
      `select id, email
       from users
       where upper(coalesce(role, '')) in ('DEVELOPER', 'ADMIN', 'STAFF')
       order by created_at asc
       limit 1`,
    );
    let adminUserId = adminUserResult.rows[0]?.id ?? null;
    let adminUserEmail = adminUserResult.rows[0]?.email ?? null;
    let adminUserCreatedBySeed = false;

    if (!adminUserId) {
      const fallbackEmail = `e2e-admin+${runId}@example.com`;
      const fallbackUsername = `e2e_admin_${runId.slice(-8)}`.toLowerCase();
      const fallbackPasswordHash = hashSync(`e2e-temp-${runId}`, 10);

      const insertedAdmin = await client.query(
        `insert into users (
           email,
           username,
           full_name,
           password_hash,
           role,
           is_active,
           must_change_password,
           password_updated_at
         )
         values ($1, $2, $3, $4, 'ADMIN', true, false, now())
         returning id, email`,
        [fallbackEmail, fallbackUsername, "E2E Seed Admin", fallbackPasswordHash],
      );

      adminUserId = insertedAdmin.rows[0]?.id ?? null;
      adminUserEmail = insertedAdmin.rows[0]?.email ?? fallbackEmail;
      adminUserCreatedBySeed = true;
    }

    if (!adminUserId) {
      throw new Error(
        "No ADMIN/STAFF/DEVELOPER user exists and seed could not create a fallback admin user.",
      );
    }

    const vehicleFeatures = {
      source: "e2e_tour_seed",
      e2e_run_id: runId,
      public_visible: true,
      public_order: 1,
      name: `${vehicleMake} ${vehicleModel}`,
      category: "Sedan",
      transmission: "Automatic",
      seats: 5,
      bags: 2,
      featured: false,
      legacy_id: runId,
      slug: `e2e-${runId}`,
    };

    const vehicleResult = await client.query(
      `insert into vehicles (
         make,
         model,
         year,
         daily_rate_cents,
         deposit_cents,
         status,
         features_json,
         image_urls_json
       )
       values ($1, $2, $3, $4, $5, 'AVAILABLE', $6::jsonb, $7::jsonb)
       returning id`,
      [
        vehicleMake,
        vehicleModel,
        vehicleYear,
        12500,
        250000,
        JSON.stringify(vehicleFeatures),
        JSON.stringify(["/window.svg"]),
      ],
    );
    const vehicleId = vehicleResult.rows[0].id;

    await client.query(
      `insert into vehicle_profiles (
         vehicle_id,
         vehicle_type,
         vehicle_class,
         year,
         color,
         current_location_label,
         odometer_value,
         odometer_unit,
         needs_cleaning
       )
       values ($1::uuid, 'SEDAN', 'STANDARD', $2, 'Blue', 'Montego Bay', 40000, 'KM', false)
       on conflict (vehicle_id)
       do update set
         vehicle_type = excluded.vehicle_type,
         vehicle_class = excluded.vehicle_class,
         year = excluded.year,
         color = excluded.color,
         current_location_label = excluded.current_location_label,
         odometer_value = excluded.odometer_value,
         odometer_unit = excluded.odometer_unit,
         needs_cleaning = excluded.needs_cleaning,
         updated_at = now()`,
      [vehicleId, vehicleYear],
    );

    const pickupLocationResult = await client.query(
      `insert into booking_locations (
         label,
         allow_pickup,
         allow_dropoff,
         is_active,
         sort_order,
         created_by
       )
       values ($1, true, false, true, 10, $2::uuid)
       returning id`,
      [pickupLabel, adminUserId],
    );

    const dropoffLocationResult = await client.query(
      `insert into booking_locations (
         label,
         allow_pickup,
         allow_dropoff,
         is_active,
         sort_order,
         created_by
       )
       values ($1, false, true, true, 11, $2::uuid)
       returning id`,
      [dropoffLabel, adminUserId],
    );

    const customerResult = await client.query(
      `insert into customers (full_name, email, phone, notes)
       values ($1, $2, $3, $4)
       returning id`,
      [`E2E Customer ${runId}`, customerEmail, "+18765550000", `E2E seed ${runId}`],
    );

    const insurancePlanResult = await client.query(
      `insert into insurance_plans (
         vehicle_id,
         is_enabled,
         price_per_day_cents,
         is_global_default,
         created_by
       )
       values ($1::uuid, true, 1500, false, $2::uuid)
       returning id`,
      [vehicleId, adminUserId],
    );

    const depreciationProfileResult = await client.query(
      `insert into vehicle_depreciation_profiles (
         vehicle_id,
         purchase_price_cents,
         expected_rest_value_cents,
         purchase_date,
         odometer_at_purchase_km,
         depreciation_months,
         method,
         is_active,
         notes
       )
       values ($1::uuid, $2, $3, $4::date, $5, $6, 'STRAIGHT_LINE', true, $7)
       on conflict (vehicle_id)
       do update set
         purchase_price_cents = excluded.purchase_price_cents,
         expected_rest_value_cents = excluded.expected_rest_value_cents,
         purchase_date = excluded.purchase_date,
         odometer_at_purchase_km = excluded.odometer_at_purchase_km,
         depreciation_months = excluded.depreciation_months,
         method = excluded.method,
         is_active = excluded.is_active,
         notes = excluded.notes,
         updated_at = now()
       returning id`,
      [vehicleId, 450000000, 90000000, toDateOnly(purchaseDate), 35000, 60, `E2E seed ${runId}`],
    );

    const maintenanceRecordResult = await client.query(
      `insert into vehicle_maintenance_records (
         vehicle_id,
         status,
         category,
         title,
         description,
         scheduled_date,
         service_date,
         total_cost_cents,
         currency,
         priority,
         created_by_user_id
       )
       values ($1::uuid, 'SCHEDULED', 'SERVICE', $2, $3, $4::date, $5::date, 1250000, 'JMD', 'NORMAL', $6::uuid)
       returning id`,
      [
        vehicleId,
        maintenanceTitle,
        `Seed maintenance record for run ${runId}`,
        toDateOnly(scheduledDate),
        toDateOnly(scheduledDate),
        adminUserId,
      ],
    );
    const maintenanceRecordId = maintenanceRecordResult.rows[0].id;

    const hasStatusHistoryTable = await client.query(
      "select (to_regclass('public.vehicle_maintenance_status_history') is not null) as exists",
    );
    if (hasStatusHistoryTable.rows[0]?.exists) {
      await client.query(
        `insert into vehicle_maintenance_status_history (
           maintenance_record_id,
           vehicle_id,
           previous_status,
           next_status,
           note,
           changed_by_user_id
         )
         values ($1::uuid, $2::uuid, null, 'SCHEDULED', $3, $4::uuid)`,
        [maintenanceRecordId, vehicleId, `Seeded for ${runId}`, adminUserId],
      );
    }

    const hasBlockoutLinkedColumn = await tableHasColumn(client, "blockouts", "linked_maintenance_id");
    const hasBlockoutSourceColumn = await tableHasColumn(client, "blockouts", "source");

    let blockoutId: string | null = null;

    if (hasBlockoutLinkedColumn && hasBlockoutSourceColumn) {
      const blockoutResult = await client.query(
        `insert into blockouts (
           vehicle_id,
           start_at,
           end_at,
           reason,
           notes,
           created_by,
           linked_maintenance_id,
           source
         )
         values ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::uuid, $7::uuid, 'MAINTENANCE')
         returning id`,
        [
          vehicleId,
          blockoutStart.toISOString(),
          blockoutEnd.toISOString(),
          maintenanceReason,
          `Seed maintenance blockout ${runId}`,
          adminUserId,
          maintenanceRecordId,
        ],
      );
      blockoutId = blockoutResult.rows[0].id;
    } else {
      const blockoutResult = await client.query(
        `insert into blockouts (
           vehicle_id,
           start_at,
           end_at,
           reason,
           notes,
           created_by
         )
         values ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::uuid)
         returning id`,
        [
          vehicleId,
          blockoutStart.toISOString(),
          blockoutEnd.toISOString(),
          maintenanceReason,
          `Seed maintenance blockout ${runId}`,
          adminUserId,
        ],
      );
      blockoutId = blockoutResult.rows[0].id;
    }

    const hasMaintenanceRecordIdOnDocuments = await tableHasColumn(
      client,
      "vehicle_documents",
      "maintenance_record_id",
    );

    let documentId: string | null = null;

    if (hasMaintenanceRecordIdOnDocuments) {
      const docResult = await client.query(
        `insert into vehicle_documents (
           vehicle_id,
           maintenance_record_id,
           folder,
           document_type,
           title,
           storage_provider,
           storage_key,
           mime_type,
           size_bytes,
           file_size_bytes,
           tags,
           label,
           uploaded_by_user_id
         )
         values (
           $1::uuid,
           $2::uuid,
           'Maintenance',
           'SERVICE_INVOICE',
           $3,
           'UPLOADCARE_FILE_ID',
           $4,
           'application/pdf',
           128,
           128,
           '[]'::jsonb,
           'Seed Invoice',
           $5::uuid
         )
         returning id`,
        [
          vehicleId,
          maintenanceRecordId,
          `E2E Seed Invoice ${runId}`,
          `e2e-seed-${runId}.pdf`,
          adminUserId,
        ],
      );
      documentId = docResult.rows[0].id;
    }

    const bookingFixtureBaseCreatedAt = addDays(now, -8);
    const bookingFixtureDepositCents = 12000;
    const bookingFixtureDailyRateCents = 12000;
    const bookingFixtureDays = 4;

    const unpaidDepositPricing = buildPricingSnapshot({
      dailyRateCents: bookingFixtureDailyRateCents,
      days: bookingFixtureDays,
      depositCents: bookingFixtureDepositCents,
      paidToDate: 0,
      paymentOption: "DEPOSIT",
    });
    const unpaidDepositBooking = await insertPromoBooking(client, {
      vehicleId,
      customerId: customerResult.rows[0].id,
      pickupLocation: pickupLabel,
      dropoffLocation: dropoffLabel,
      startDate: toDateOnly(addDays(now, 7)),
      endDate: toDateOnly(addDays(now, 10)),
      status: "PENDING_PAYMENT",
      pricingJson: unpaidDepositPricing,
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 0).toISOString(),
    });

    const partialBalancePricing = buildPricingSnapshot({
      dailyRateCents: bookingFixtureDailyRateCents,
      days: bookingFixtureDays,
      depositCents: bookingFixtureDepositCents,
      paidToDate: bookingFixtureDepositCents,
      paymentOption: "DEPOSIT",
    });
    const partialBalanceBooking = await insertPromoBooking(client, {
      vehicleId,
      customerId: customerResult.rows[0].id,
      pickupLocation: pickupLabel,
      dropoffLocation: dropoffLabel,
      startDate: toDateOnly(addDays(now, 12)),
      endDate: toDateOnly(addDays(now, 15)),
      status: "CONFIRMED",
      pricingJson: partialBalancePricing,
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 10).toISOString(),
    });
    const partialBalanceDepositPayment = await insertPayment(client, {
      bookingId: partialBalanceBooking.id,
      provider: "MANUAL",
      amountCents: bookingFixtureDepositCents,
      status: "DEPOSIT_PAID",
      providerRef: `E2E_PARTIAL_DEPOSIT_${runId}`,
      metadata: {
        source: "e2e_seed",
        payment_type: "deposit",
        method: "ADMIN",
        method_label: "Manual / Admin",
      },
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 11).toISOString(),
    });

    const fullyPaidPricing = buildPricingSnapshot({
      dailyRateCents: bookingFixtureDailyRateCents,
      days: bookingFixtureDays,
      depositCents: bookingFixtureDepositCents,
      paidToDate: bookingFixtureDailyRateCents * bookingFixtureDays,
      paymentOption: "FULL",
    });
    const fullyPaidBooking = await insertPromoBooking(client, {
      vehicleId,
      customerId: customerResult.rows[0].id,
      pickupLocation: pickupLabel,
      dropoffLocation: dropoffLabel,
      startDate: toDateOnly(addDays(now, 18)),
      endDate: toDateOnly(addDays(now, 21)),
      status: "CONFIRMED",
      pricingJson: fullyPaidPricing,
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 20).toISOString(),
    });
    const fullyPaidDepositPayment = await insertPayment(client, {
      bookingId: fullyPaidBooking.id,
      provider: "MANUAL",
      amountCents: bookingFixtureDepositCents,
      status: "DEPOSIT_PAID",
      providerRef: `E2E_FULL_DEPOSIT_${runId}`,
      metadata: {
        source: "e2e_seed",
        payment_type: "deposit",
        method: "ADMIN",
        method_label: "Manual / Admin",
      },
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 21).toISOString(),
    });
    const fullyPaidBalancePayment = await insertPayment(client, {
      bookingId: fullyPaidBooking.id,
      provider: "MANUAL",
      amountCents: Math.max(0, fullyPaidPricing.total_cents - bookingFixtureDepositCents),
      status: "DEPOSIT_PAID",
      providerRef: `E2E_FULL_BALANCE_${runId}`,
      metadata: {
        source: "e2e_seed",
        payment_type: "balance",
        method: "ADMIN",
        method_label: "Manual / Admin",
      },
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 22).toISOString(),
    });

    const refundRequiredPricing = buildPricingSnapshot({
      dailyRateCents: bookingFixtureDailyRateCents,
      days: bookingFixtureDays,
      depositCents: bookingFixtureDepositCents,
      paidToDate: bookingFixtureDepositCents,
      paymentOption: "DEPOSIT",
    });
    const refundRequiredBooking = await insertPromoBooking(client, {
      vehicleId,
      customerId: customerResult.rows[0].id,
      pickupLocation: pickupLabel,
      dropoffLocation: dropoffLabel,
      startDate: toDateOnly(addDays(now, 24)),
      endDate: toDateOnly(addDays(now, 27)),
      status: "CANCELLED",
      pricingJson: refundRequiredPricing,
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 30).toISOString(),
    });
    const refundRequiredDepositPayment = await insertPayment(client, {
      bookingId: refundRequiredBooking.id,
      provider: "MANUAL",
      amountCents: bookingFixtureDepositCents,
      status: "DEPOSIT_PAID",
      providerRef: `E2E_REFUND_REQUIRED_${runId}`,
      metadata: {
        source: "e2e_seed",
        payment_type: "deposit",
        method: "BANK_TRANSFER",
        method_label: "Bank Transfer",
      },
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 31).toISOString(),
    });

    const refundableWipayPricing = buildPricingSnapshot({
      dailyRateCents: bookingFixtureDailyRateCents,
      days: bookingFixtureDays,
      depositCents: bookingFixtureDepositCents,
      paidToDate: bookingFixtureDepositCents,
      paymentOption: "DEPOSIT",
    });
    const refundableWipayBooking = await insertPromoBooking(client, {
      vehicleId,
      customerId: customerResult.rows[0].id,
      pickupLocation: pickupLabel,
      dropoffLocation: dropoffLabel,
      startDate: toDateOnly(addDays(now, 30)),
      endDate: toDateOnly(addDays(now, 33)),
      status: "CONFIRMED",
      pricingJson: refundableWipayPricing,
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 40).toISOString(),
    });
    const refundableWipayPayment = await insertPayment(client, {
      bookingId: refundableWipayBooking.id,
      provider: "WIPAY",
      amountCents: bookingFixtureDepositCents,
      status: "DEPOSIT_PAID",
      providerRef: `E2E_WIPAY_REFUND_${runId}`,
      metadata: {
        source: "e2e_seed",
        payment_type: "deposit",
        order_id: `ORDER_${runId}`,
      },
      createdAt: addMinutes(bookingFixtureBaseCreatedAt, 41).toISOString(),
    });

    const promoSuffix = runId.slice(-4).toUpperCase();
    const promoCreatedBase = new Date(now);
    promoCreatedBase.setSeconds(0, 0);
    const promoHolidayA = toDateOnly(addDays(now, 60));
    const promoHolidayB = toDateOnly(addDays(now, 61));

    const promoCreatedAt = (offsetMinutes: number) => addMinutes(promoCreatedBase, -offsetMinutes).toISOString();

    const activePromo = await insertPromoCode(client, {
      code: `ACTIVE${promoSuffix}`,
      discountType: "PERCENT",
      discountValue: 10,
      createdBy: adminUserId,
      createdAt: promoCreatedAt(0),
    });
    const scheduledPromo = await insertPromoCode(client, {
      code: `SCHED${promoSuffix}`,
      discountValue: 2500,
      startAt: addDays(now, 14).toISOString(),
      createdBy: adminUserId,
      createdAt: promoCreatedAt(1),
    });
    const expiredPromo = await insertPromoCode(client, {
      code: `EXPIRE${promoSuffix}`,
      discountValue: 2000,
      endAt: addDays(now, -10).toISOString(),
      createdBy: adminUserId,
      createdAt: promoCreatedAt(2),
    });
    const limitReachedPromo = await insertPromoCode(client, {
      code: `LIMIT${promoSuffix}`,
      discountValue: 1500,
      maxRedemptions: 20,
      createdBy: adminUserId,
      createdAt: promoCreatedAt(3),
    });
    const inactivePromo = await insertPromoCode(client, {
      code: `OFF${promoSuffix}`,
      isActive: false,
      discountValue: 1750,
      createdBy: adminUserId,
      createdAt: promoCreatedAt(4),
    });
    const vehicleRestrictedPromo = await insertPromoCode(client, {
      code: `VEH${promoSuffix}`,
      discountValue: 2200,
      allowedVehicleIds: [vehicleId],
      minSubtotalCents: 15000,
      createdBy: adminUserId,
      createdAt: promoCreatedAt(5),
    });
    const blackoutRestrictedPromo = await insertPromoCode(client, {
      code: `BLACK${promoSuffix}`,
      discountValue: 1800,
      blackoutDates: [promoHolidayA, promoHolidayB],
      createdBy: adminUserId,
      createdAt: promoCreatedAt(6),
    });
    const perCustomerLimitedPromo = await insertPromoCode(client, {
      code: `CUST${promoSuffix}`,
      discountValue: 1200,
      maxRedemptionsPerCustomer: 1,
      createdBy: adminUserId,
      createdAt: promoCreatedAt(7),
    });
    const reconstructedPromo = await insertPromoCode(client, {
      code: `BACK${promoSuffix}`,
      discountValue: 2600,
      createdBy: adminUserId,
      createdAt: promoCreatedAt(8),
    });

    const fillerPromos: PromoFixtureRef[] = [];
    for (let index = 0; index < 4; index += 1) {
      fillerPromos.push(
        await insertPromoCode(client, {
          code: `FILL${index + 1}${promoSuffix}`,
          discountValue: 1000 + index * 100,
          createdBy: adminUserId,
          createdAt: promoCreatedAt(9 + index),
        }),
      );
    }

    const limitDiscountCents = 1500;
    for (let index = 0; index < 25; index += 1) {
      const bookingCreatedAt = addMinutes(addDays(now, -6), index).toISOString();
      const bookingStart = addDays(now, 20 + index);
      const bookingEnd = addDays(bookingStart, 3);
      const booking = await insertPromoBooking(client, {
        vehicleId,
        customerId: customerResult.rows[0].id,
        pickupLocation: pickupLabel,
        startDate: toDateOnly(bookingStart),
        endDate: toDateOnly(bookingEnd),
        status: index < 20 ? "CONFIRMED" : "CANCELLED",
        pricingJson: {
          subtotal_cents: 36000,
          total_cents: 34500,
          deposit_cents: 5000,
          amount_paid: index < 20 ? 5000 : 0,
          balance_due: index < 20 ? 29500 : 34500,
          payment_status: index < 20 ? "DEPOSIT_PAID" : "UNPAID",
          promo_code_id: limitReachedPromo.id,
          promo_code: limitReachedPromo.code,
          promo_discount_cents: limitDiscountCents,
        },
        createdAt: bookingCreatedAt,
      });

      await insertPayment(client, {
        bookingId: booking.id,
        provider: "MANUAL",
        amountCents: 5000,
        status: "DEPOSIT_PAID",
        providerRef: `E2E_PROMO_LIMIT_PAID_${runId}_${index + 1}`,
        metadata: { source: "e2e_seed", promoCodeId: limitReachedPromo.id },
        createdAt: bookingCreatedAt,
      });

      const redeemedAt = addMinutes(addDays(now, -3), index).toISOString();
      await insertPromoRedemptionEvent(client, {
        promoCodeId: limitReachedPromo.id,
        bookingId: booking.id,
        customerId: customerResult.rows[0].id,
        customerEmail,
        discountAmountCents: limitDiscountCents,
        eventType: "REDEEMED",
        eventAt: redeemedAt,
        metadata: { source: "e2e_seed_live_promo" },
      });

      if (index < 20) {
        await insertPromoRedemption(client, {
          promoCodeId: limitReachedPromo.id,
          bookingId: booking.id,
          customerId: customerResult.rows[0].id,
          customerEmail,
          discountAmountCents: limitDiscountCents,
          createdAt: redeemedAt,
        });
      } else {
        const reversedAt = addMinutes(addDays(now, -2), index).toISOString();
        await insertPayment(client, {
          bookingId: booking.id,
          provider: "WIPAY",
          amountCents: -5000,
          status: "REFUNDED",
          providerRef: `E2E_PROMO_LIMIT_REFUND_${runId}_${index + 1}`,
          metadata: { source: "e2e_seed", promoCodeId: limitReachedPromo.id },
          createdAt: reversedAt,
        });
        await insertPromoRedemptionEvent(client, {
          promoCodeId: limitReachedPromo.id,
          bookingId: booking.id,
          customerId: customerResult.rows[0].id,
          customerEmail,
          discountAmountCents: limitDiscountCents,
          eventType: "REVERSED",
          eventAt: reversedAt,
          metadata: { source: "e2e_seed_live_promo" },
        });
      }
    }

    const reconstructedBookingCreatedAt = addMinutes(addDays(now, -1), 15).toISOString();
    const reconstructedBooking = await insertPromoBooking(client, {
      vehicleId,
      customerId: customerResult.rows[0].id,
      pickupLocation: pickupLabel,
      startDate: toDateOnly(addDays(now, 10)),
      endDate: toDateOnly(addDays(now, 13)),
      status: "CONFIRMED",
      pricingJson: {
        subtotal_cents: 32000,
        total_cents: 29400,
        deposit_cents: 5000,
        amount_paid: 5000,
        balance_due: 24400,
        payment_status: "DEPOSIT_PAID",
        promo_code_id: reconstructedPromo.id,
        promo_code: reconstructedPromo.code,
        promo_discount_cents: 2600,
      },
      createdAt: reconstructedBookingCreatedAt,
    });
    await insertPayment(client, {
      bookingId: reconstructedBooking.id,
      provider: "MANUAL",
      amountCents: 5000,
      status: "DEPOSIT_PAID",
      providerRef: `E2E_PROMO_RECONSTRUCTED_PAID_${runId}`,
      metadata: { source: "e2e_seed", promoCodeId: reconstructedPromo.id },
      createdAt: reconstructedBookingCreatedAt,
    });
    await insertPromoRedemption(client, {
      promoCodeId: reconstructedPromo.id,
      bookingId: reconstructedBooking.id,
      customerId: customerResult.rows[0].id,
      customerEmail,
      discountAmountCents: 2600,
      createdAt: reconstructedBookingCreatedAt,
    });
    await insertPromoRedemptionEvent(client, {
      promoCodeId: reconstructedPromo.id,
      bookingId: reconstructedBooking.id,
      customerId: customerResult.rows[0].id,
      customerEmail,
      discountAmountCents: 2600,
      eventType: "REDEEMED",
      eventAt: reconstructedBookingCreatedAt,
      metadata: {
        reconstructed: true,
        source: "legacy_reconstruction",
        timestampSource: "payment",
      },
    });

    await client.query("commit");

    const fixtures: E2EFixtures = {
      runId,
      createdAt: new Date().toISOString(),
      adminUser: {
        id: adminUserId,
        email: adminUserEmail,
        createdBySeed: adminUserCreatedBySeed,
      },
      vehicle: {
        id: vehicleId,
        make: vehicleMake,
        model: vehicleModel,
        year: vehicleYear,
        label: `${vehicleYear} ${vehicleMake} ${vehicleModel}`,
      },
      bookingLocations: {
        pickup: { id: pickupLocationResult.rows[0].id, label: pickupLabel },
        dropoff: { id: dropoffLocationResult.rows[0].id, label: dropoffLabel },
      },
      customer: {
        id: customerResult.rows[0].id,
        email: customerEmail,
      },
      insurancePlan: {
        id: insurancePlanResult.rows[0].id,
      },
      depreciationProfile: {
        id: depreciationProfileResult.rows[0].id,
      },
      maintenance: {
        recordId: maintenanceRecordId,
        title: maintenanceTitle,
        scheduledDate: toDateOnly(scheduledDate),
        blockoutReason: maintenanceReason,
        blockoutId,
      },
      document: {
        id: documentId,
      },
      bookings: {
        unpaidDeposit: buildBookingFixtureRef({
          booking: unpaidDepositBooking,
          status: "PENDING_PAYMENT",
          pricingJson: unpaidDepositPricing,
          paidToDate: 0,
        }),
        partialBalance: buildBookingFixtureRef({
          booking: partialBalanceBooking,
          status: "CONFIRMED",
          pricingJson: partialBalancePricing,
          paidToDate: bookingFixtureDepositCents,
          payments: {
            deposit: partialBalanceDepositPayment,
          },
        }),
        fullyPaid: buildBookingFixtureRef({
          booking: fullyPaidBooking,
          status: "CONFIRMED",
          pricingJson: fullyPaidPricing,
          paidToDate: Number(fullyPaidPricing.total_cents ?? 0),
          payments: {
            deposit: fullyPaidDepositPayment,
            balance: fullyPaidBalancePayment,
          },
        }),
        refundRequired: buildBookingFixtureRef({
          booking: refundRequiredBooking,
          status: "CANCELLED",
          pricingJson: refundRequiredPricing,
          paidToDate: bookingFixtureDepositCents,
          payments: {
            deposit: refundRequiredDepositPayment,
          },
        }),
        refundableWipay: buildBookingFixtureRef({
          booking: refundableWipayBooking,
          status: "CONFIRMED",
          pricingJson: refundableWipayPricing,
          paidToDate: bookingFixtureDepositCents,
          payments: {
            wipay: refundableWipayPayment,
          },
        }),
      },
      promoCodes: {
        active: activePromo,
        scheduled: scheduledPromo,
        expired: expiredPromo,
        limitReached: limitReachedPromo,
        inactive: inactivePromo,
        vehicleRestricted: vehicleRestrictedPromo,
        blackoutRestricted: blackoutRestrictedPromo,
        perCustomerLimited: perCustomerLimitedPromo,
        reconstructedHistory: reconstructedPromo,
        fillers: fillerPromos,
      },
    };

    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(FIXTURES_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");

    console.log("E2E seed complete:");
    console.log(
      JSON.stringify(
        {
          runId: fixtures.runId,
          vehicleId: fixtures.vehicle.id,
          maintenanceRecordId: fixtures.maintenance.recordId,
          depreciationProfileId: fixtures.depreciationProfile.id,
          unpaidDepositBookingId: fixtures.bookings.unpaidDeposit.id,
          partialBalanceBookingId: fixtures.bookings.partialBalance.id,
          fullyPaidBookingId: fixtures.bookings.fullyPaid.id,
          refundRequiredBookingId: fixtures.bookings.refundRequired.id,
          refundableWipayBookingId: fixtures.bookings.refundableWipay.id,
          promoLimitReachedId: fixtures.promoCodes.limitReached.id,
          promoReconstructedId: fixtures.promoCodes.reconstructedHistory.id,
          fixturesPath: FIXTURES_PATH,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E2E seed failed: ${message}`);
  process.exit(1);
});
