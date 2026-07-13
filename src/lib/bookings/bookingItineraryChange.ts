import { evaluateVehicleAvailability } from "@/lib/bookings/vehicleAvailabilityDiagnostics";
import { buildQuotePricingSnapshot, QuotePricingError } from "@/lib/quotes/quotePricing";
import {
  computeBookingPricing,
  fetchNetPaidToDate,
  readInsurancePricingFields,
  readPaymentOption,
  readPromoPricingFields,
  type Queryable,
} from "@/lib/payments/pricing";

export class BookingItineraryChangeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "ITINERARY_INVALID",
  ) {
    super(message);
  }
}

export type BookingItinerarySource = {
  id: string;
  status: string;
  customer_id: string;
  customer_email: string;
  pricing_json: Record<string, unknown> | null;
};

export async function evaluateBookingItineraryChange(input: {
  client: Queryable;
  booking: BookingItinerarySource;
  vehicleId: string;
  startAt: string;
  endAt: string;
  startDate: string;
  endDate: string;
  customerEmail?: string | null;
  insuranceSelected?: boolean;
  promoCode?: string | null;
}) {
  const vehicleResult = await input.client.query(
    `select
       v.id,
       v.public_id,
       v.make,
       v.model,
       v.year,
       v.status,
       v.daily_rate_cents,
       v.deposit_cents,
       v.deleted_at,
       lower(coalesce(v.features_json->>'public_visible', 'false')) in ('true','1','yes') as public_visible
     from vehicles v
     where v.id = $1
     limit 1`,
    [input.vehicleId],
  );
  if (vehicleResult.rowCount === 0) {
    throw new BookingItineraryChangeError("Selected vehicle was not found.", 404, "VEHICLE_NOT_FOUND");
  }

  const row = vehicleResult.rows[0] as {
    id: string;
    public_id: string | null;
    make: string;
    model: string;
    year: number;
    status: string;
    daily_rate_cents: number;
    deposit_cents: number;
    deleted_at: string | null;
    public_visible: boolean;
  };
  const vehicle = {
    id: row.id,
    publicId: row.public_id,
    make: row.make,
    model: row.model,
    year: row.year,
    status: row.status,
    publicVisible: row.public_visible,
    dailyRateCents: row.daily_rate_cents,
    deletedAt: row.deleted_at,
  };
  const [decision] = await evaluateVehicleAvailability(
    [vehicle],
    { startAt: input.startAt, endAt: input.endAt },
    {
      client: input.client,
      excludeBookingId: input.booking.id,
      includeBlockouts: true,
      publicEligibility: false,
    },
  );
  if (!decision?.available) {
    throw new BookingItineraryChangeError(
      decision?.reason ?? "The selected vehicle is unavailable for this window.",
      409,
      decision?.reasonCode ?? "VEHICLE_UNAVAILABLE",
    );
  }

  const currentPricing = input.booking.pricing_json ?? {};
  const insurance = readInsurancePricingFields(currentPricing);
  const promo = readPromoPricingFields(currentPricing);
  const insuranceSelected = input.insuranceSelected ?? insurance.insuranceSelected;
  const promoCode = input.promoCode === undefined ? promo.promoCode : input.promoCode;
  let quote;
  try {
    quote = await buildQuotePricingSnapshot({
      vehicleId: input.vehicleId,
      startAt: input.startAt,
      endAt: input.endAt,
      insuranceEnabled: insuranceSelected,
      insurancePlanId: null,
      promoCode,
      customerId: input.booking.customer_id,
      customerEmail: input.customerEmail ?? input.booking.customer_email,
      deliverySelected: currentPricing.delivery_selected === true,
      deliveryZoneLabel:
        typeof currentPricing.delivery_zone_label === "string"
          ? currentPricing.delivery_zone_label
          : null,
    }, { client: input.client });
  } catch (error) {
    if (error instanceof QuotePricingError) {
      throw new BookingItineraryChangeError(error.message, error.status, error.code);
    }
    throw error;
  }
  const netPaidToDate = await fetchNetPaidToDate(input.booking.id, { client: input.client });
  const pricing = quote.pricingJson;
  const summary = computeBookingPricing({
    bookingId: input.booking.id,
    bookingStatus: input.booking.status,
    startDate: input.startDate,
    endDate: input.endDate,
    days: Number(pricing.days ?? 0),
    dailyRate: Number(pricing.daily_rate_cents ?? row.daily_rate_cents),
    deposit: quote.summary.depositRequiredCents,
    baseTotal: quote.summary.baseTotalCents,
    extraFeesTotal: Number(pricing.extra_fees_cents ?? 0),
    paymentOption: readPaymentOption(currentPricing),
    netPaidToDate,
    promoCode: quote.promoCode,
    promoDiscount: quote.summary.discountTotalCents,
    insuranceSelected: quote.insuranceEnabled,
    insurancePricePerDay: Number(pricing.insurance_price_per_day_cents ?? 0),
    insuranceTotal: quote.summary.insuranceTotalCents,
  });

  return {
    vehicle,
    vehicleLabel: quote.vehicleLabel,
    insurancePlanId: quote.insurancePlanId,
    promoId: quote.promoId,
    summary,
    pricingJson: {
      ...currentPricing,
      ...pricing,
      amount_paid: summary.netPaidToDate,
      paid_to_date: summary.netPaidToDate,
      balance_due: summary.balanceDue,
      payment_status: summary.paymentStatus,
      payment_option_selected: summary.paymentOption,
      refund_required: summary.refundRequired,
    },
  };
}
