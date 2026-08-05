import type { Vehicle } from "@/data/catalog";
import { randomUUID } from "expo-crypto";
import * as WebBrowser from "expo-web-browser";

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

export const API_BASE_URL = (configuredBaseUrl || "https://curatedcarrentals.com").replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = 12_000;

type RemoteVehicle = {
  id: string;
  name: string;
  category: string;
  transmission: "Automatic" | "Manual";
  seats: number;
  bags: number;
  pricePerDay: number;
  images: string[];
  description: string;
  year: number;
  security_deposit_jmd: number | null;
  deposit_cents: number;
  slug: string;
};

export type AvailabilityWindow = {
  pickupDate: string;
  dropoffDate: string;
  pickupTime?: string;
  dropoffTime?: string;
};

export type PricingQuote = {
  days: number;
  baseTotal: number;
  insurancePricePerDay: number;
  insuranceTotal: number;
  discountTotal: number;
  subtotal: number;
  total: number;
  amountDue: number;
  depositRequired: number;
  dueNow: number;
  dueOnPickup: number;
  reserveShortfall: number;
  balanceDue: number;
  paymentOption: "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";
  promoCode: string | null;
  currency: string;
};

export type PaymentOption = "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";

export type PromoValidation = {
  code: string;
  discountAmount: number;
  totalAfterDiscount: number;
  deposit: number;
};

export type BookingLocation = {
  id: string;
  label: string;
  locationTypeKey: "OFFICE" | "AIRPORT" | "CUSTOM_ADDRESS" | string;
  pickupLabel: string;
  dropoffLabel: string;
  allowPickup: boolean;
  allowDropoff: boolean;
};

export type InsuranceOption = {
  enabled: boolean;
  planId: string | null;
  pricePerDay: number;
  coverage: number;
};

export type BookingCreateInput = {
  vehicleId: string;
  fullName: string;
  email: string;
  phone: string;
  startDate: string;
  endDate: string;
  pickupLocation: BookingLocation;
  dropoffLocation: BookingLocation;
  pickupAddress?: string;
  dropoffAddress?: string;
  insuranceSelected: boolean;
  insurancePlanId: string | null;
  signatureDataUrl: string;
  turnstileToken: string;
  promoCode?: string | null;
  paymentOption: PaymentOption;
  customPaymentAmount?: number | null;
};

export type BookingCreateResult = {
  bookingId: string;
  bookingAccessToken: string;
  status: string;
  duplicate?: boolean;
};

export type BookingStatus = {
  id: string;
  reference: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  paidToDate: number;
  balanceDue: number;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : "The rental service could not complete this request.";
      throw new ApiError(message, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("The rental service took too long to respond.", 408);
    }
    throw new ApiError("Unable to reach the rental service. Check your connection and try again.", 0);
  } finally {
    clearTimeout(timeout);
  }
}

function absoluteImageUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

function mapVehicle(vehicle: RemoteVehicle): Vehicle {
  return {
    id: vehicle.id,
    name: vehicle.name,
    category: vehicle.category,
    year: vehicle.year,
    transmission: vehicle.transmission,
    seats: vehicle.seats,
    bags: vehicle.bags,
    dailyRate: Math.max(0, Number(vehicle.pricePerDay) || 0),
    securityDeposit: Math.max(0, Number(vehicle.security_deposit_jmd ?? 0)),
    description: vehicle.description,
    images: vehicle.images.filter(Boolean).map((uri) => ({ uri: absoluteImageUrl(uri) })),
    slug: vehicle.slug,
    source: "live",
  };
}

export async function fetchVehicles(window?: AvailabilityWindow): Promise<Vehicle[]> {
  const params = new URLSearchParams();
  if (window) {
    params.set("pickupDate", window.pickupDate);
    params.set("dropoffDate", window.dropoffDate);
    params.set("pickupTime", window.pickupTime || "11:00");
    params.set("dropoffTime", window.dropoffTime || "11:00");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const data = await requestJson<{ vehicles: RemoteVehicle[] }>(`/api/public/vehicles${suffix}`, { cache: "no-store" });
  return Array.isArray(data.vehicles) ? data.vehicles.map(mapVehicle).filter((vehicle) => vehicle.images.length > 0) : [];
}

export async function fetchPricingQuote(input: {
  vehicleId: string;
  pickupDate: string;
  returnDate: string;
  customerEmail?: string;
  insuranceSelected?: boolean;
  insurancePlanId?: string | null;
  deliverySelected?: boolean;
  deliveryZoneLabel?: string | null;
  promoCode?: string | null;
  paymentOption?: PaymentOption;
  customAmount?: number | null;
}): Promise<PricingQuote> {
  const data = await requestJson<{ ok: true; summary: Omit<PricingQuote, "currency">; currency: string }>(
    "/api/public/pricing/quote",
    {
      method: "POST",
      body: JSON.stringify({
        vehicleId: input.vehicleId,
        startAt: `${input.pickupDate}T11:00:00-05:00`,
        endAt: `${input.returnDate}T11:00:00-05:00`,
        customerEmail: input.customerEmail || null,
        insuranceSelected: input.insuranceSelected === true,
        insurancePlanId: input.insurancePlanId || null,
        promoCode: input.promoCode || null,
        paymentOption: input.paymentOption || "DEPOSIT",
        customAmount: input.paymentOption === "CUSTOM" ? input.customAmount : null,
        deliverySelected: input.deliverySelected === true,
        deliveryZoneLabel: input.deliveryZoneLabel || null,
      }),
    },
  );
  return { ...data.summary, currency: data.currency || "JMD" };
}

export async function validatePromoCode(input: {
  code: string;
  vehicleId: string;
  pickupDate: string;
  returnDate: string;
  customerEmail?: string;
  insuranceSelected?: boolean;
  insurancePlanId?: string | null;
  deliverySelected?: boolean;
  deliveryZoneLabel?: string | null;
}): Promise<PromoValidation> {
  const data = await requestJson<{
    ok: true;
    code: string;
    discountAmountCents: number;
    totalAfterDiscountCents: number;
    depositCents: number;
  }>("/api/public/promos/validate", {
    method: "POST",
    body: JSON.stringify({
      code: input.code,
      vehicleId: input.vehicleId,
      startDate: input.pickupDate,
      endDate: input.returnDate,
      customerEmail: input.customerEmail || null,
      insuranceSelected: input.insuranceSelected === true,
      insurancePlanId: input.insurancePlanId || null,
      deliverySelected: input.deliverySelected === true,
      deliveryZoneLabel: input.deliveryZoneLabel || null,
    }),
  });
  return {
    code: data.code,
    discountAmount: Math.max(0, Number(data.discountAmountCents) || 0),
    totalAfterDiscount: Math.max(0, Number(data.totalAfterDiscountCents) || 0),
    deposit: Math.max(0, Number(data.depositCents) || 0),
  };
}

export async function fetchMinimumRentalDays(): Promise<number> {
  const data = await requestJson<{ minimumDays: number }>("/api/public/minimum-rental-days", { cache: "no-store" });
  return Math.max(1, Math.round(Number(data.minimumDays) || 1));
}

export async function fetchBookingLocations(): Promise<BookingLocation[]> {
  type RemoteLocation = {
    id: string;
    label: string;
    location_type_key: string;
    pickup_label: string;
    dropoff_label: string;
    allow_pickup: boolean;
    allow_dropoff: boolean;
  };
  const data = await requestJson<{ locations: RemoteLocation[] }>("/api/public/locations", { cache: "no-store" });
  return (Array.isArray(data.locations) ? data.locations : []).map((location) => ({
    id: location.id,
    label: location.label,
    locationTypeKey: location.location_type_key,
    pickupLabel: location.pickup_label,
    dropoffLabel: location.dropoff_label,
    allowPickup: location.allow_pickup,
    allowDropoff: location.allow_dropoff,
  }));
}

export async function fetchInsuranceOption(vehicleId: string): Promise<InsuranceOption> {
  const params = new URLSearchParams({ vehicleId });
  const data = await requestJson<{
    insurance: { enabled: boolean; planId: string | null; pricePerDayCents: number; coverageCents: number };
  }>(`/api/public/insurance?${params.toString()}`, { cache: "no-store" });
  return {
    enabled: data.insurance?.enabled === true,
    planId: data.insurance?.planId || null,
    pricePerDay: Math.max(0, Number(data.insurance?.pricePerDayCents) || 0),
    coverage: Math.max(0, Number(data.insurance?.coverageCents) || 0),
  };
}

export async function completeBookingSecurityChallenge(): Promise<string> {
  const state = randomUUID().replace(/-/g, "");
  const callbackUrl = "curatedcarrentals://booking-security";
  const challengeUrl = `${API_BASE_URL}/mobile/booking-security?${new URLSearchParams({ state }).toString()}`;
  const result = await WebBrowser.openAuthSessionAsync(challengeUrl, callbackUrl);
  if (result.type !== "success" || !result.url) {
    throw new ApiError("The booking security check was cancelled.", 0);
  }
  const callback = new URL(result.url);
  const returnedState = callback.searchParams.get("state");
  const token = callback.searchParams.get("token");
  if (returnedState !== state || !token) {
    throw new ApiError("The booking security response could not be verified.", 403);
  }
  return token;
}

export async function createBooking(input: BookingCreateInput): Promise<BookingCreateResult> {
  const pickupValues = input.pickupLocation.locationTypeKey === "CUSTOM_ADDRESS"
    ? { address: input.pickupAddress?.trim() || null }
    : {};
  const dropoffValues = input.dropoffLocation.locationTypeKey === "CUSTOM_ADDRESS"
    ? { address: input.dropoffAddress?.trim() || null }
    : {};
  const deliverySelected = input.pickupLocation.locationTypeKey === "CUSTOM_ADDRESS" || input.dropoffLocation.locationTypeKey === "CUSTOM_ADDRESS";
  const pickupText = input.pickupAddress?.trim() || input.pickupLocation.pickupLabel;
  const dropoffText = input.dropoffAddress?.trim() || input.dropoffLocation.dropoffLabel;
  const nameParts = input.fullName.trim().split(/\s+/);

  return requestJson<BookingCreateResult>("/api/public/bookings", {
    method: "POST",
    body: JSON.stringify({
      vehicleId: input.vehicleId,
      submissionKey: randomUUID(),
      turnstileToken: input.turnstileToken,
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      pickupTime: "11:00",
      dropoffTime: "11:00",
      pickupLocation: pickupText,
      dropoffLocation: dropoffText,
      pickupLocationType: input.pickupLocation.locationTypeKey,
      dropoffLocationType: input.dropoffLocation.locationTypeKey,
      pickupLocationId: input.pickupLocation.id,
      dropoffLocationId: input.dropoffLocation.id,
      pickupLocationTextSnapshot: pickupText,
      dropoffLocationTextSnapshot: dropoffText,
      bookingLocationDetails: {
        pickup: { values: pickupValues },
        dropoff: { values: dropoffValues },
      },
      insuranceSelected: input.insuranceSelected,
      insurancePlanId: input.insuranceSelected ? input.insurancePlanId : null,
      couponCode: input.promoCode || null,
      paymentOption: input.paymentOption,
      customPaymentAmountCents: input.paymentOption === "CUSTOM" ? input.customPaymentAmount : null,
      deliverySelected,
      deliveryZoneLabel: deliverySelected ? `${pickupText} → ${dropoffText}` : null,
      signatureDataUrl: input.signatureDataUrl,
      customerProfile: {
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" "),
      },
    }),
  });
}

function bookingBearerHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchBookingStatus(bookingId: string, accessToken: string): Promise<BookingStatus> {
  const data = await requestJson<{ ok: true; booking: BookingStatus }>(
    `/api/public/bookings/${encodeURIComponent(bookingId)}/status`,
    { headers: bookingBearerHeaders(accessToken), cache: "no-store" },
  );
  return data.booking;
}

export async function startBookingPayment(
  bookingId: string,
  accessToken: string,
  option: Exclude<PaymentOption, "NONE">,
  customAmount?: number | null,
): Promise<BookingStatus> {
  const path = option === "FULL"
    ? "/api/payments/wipay/full/start"
    : option === "CUSTOM"
      ? "/api/payments/wipay/custom/start"
      : "/api/payments/wipay/start";
  const data = await requestJson<{ ok: true; redirectUrl: string }>(path, {
    method: "POST",
    headers: bookingBearerHeaders(accessToken),
    body: JSON.stringify({ bookingId, customAmountCents: option === "CUSTOM" ? customAmount : undefined }),
  });
  if (!data.redirectUrl) throw new ApiError("The payment provider did not return a checkout URL.", 502);
  await WebBrowser.openBrowserAsync(data.redirectUrl, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    showTitle: true,
  });
  return fetchBookingStatus(bookingId, accessToken);
}

export async function selectPayOnPickup(bookingId: string, accessToken: string): Promise<BookingStatus> {
  await requestJson<{ ok: true }>(`/api/public/bookings/${encodeURIComponent(bookingId)}/pay-on-pickup`, {
    method: "POST",
    headers: bookingBearerHeaders(accessToken),
    body: JSON.stringify({}),
  });
  return fetchBookingStatus(bookingId, accessToken);
}

export function startDepositPayment(bookingId: string, accessToken: string) {
  return startBookingPayment(bookingId, accessToken, "DEPOSIT");
}
