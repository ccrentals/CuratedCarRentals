"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import NextImage from "next/image";
import { useRouter } from "next/navigation";

import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { PublicVehicleOptionCard } from "@/components/booking/PublicVehicleOptionCard";
import { Container } from "@/components/site/Container";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { siteContent } from "@/data/content";
import { clearBookingDraft } from "@/lib/bookings/draft";
import { MAX_DRIVERS_LICENSE_IMAGES } from "@/lib/bookings/privateFiles";
import {
  buildBookingLocationConfigs,
  type BookingLocationConfig,
  type BookingLocationFieldSchema,
  type BookingLocationFieldValueMap,
} from "@/lib/bookings/bookingLocations";
import {
  buildBookingLocationSelectionPayload,
  coerceBookingLocationFieldValues,
  getBookingLocationConfigByType,
  getBookingLocationConfigsForSide,
  getBookingLocationFieldSchemaForSide,
  getBookingLocationSnapshotText,
  validateBookingLocationSelection,
} from "@/lib/bookings/locationConfigRuntime";
import {
  reconcileVehicleRefreshState,
  VEHICLE_REFRESH_FAILURE_MESSAGE,
  createPricingLifecycleState,
  displayPricingSnapshot,
  draftRestoreSecurityState,
  pricingIsLoadingWithoutSnapshot,
  pricingIsUpdatingWithSnapshot,
  resolvePricingLifecycleError,
  resolvePricingLifecycleSuccess,
  restoreSelectionFieldsFromDraft,
  startPricingLifecycleRefresh,
  type WizardStep,
} from "@/lib/bookings/publicBookingWizardState";
import {
  defaultBookingDateTime,
  restoredPickupIsBeforeDefault,
  validateMinimumRentalDays,
} from "@/lib/bookings/minimumRentalDays";
import {
  JAMAICA_PARISHES,
  isJamaicaCountry,
  normalizeCountryName,
  normalizeJamaicaParish,
} from "@/lib/jamaicaParishes";
import { calcRentalDays } from "@/lib/payments/dateMath";
import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";
import { isEmail, isNonEmptyString } from "@/lib/validators";

type PublicVehicle = {
  id: string;
  name: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
  security_deposit_jmd?: number | null;
  images?: string[];
  category?: string;
  seats?: number;
  doors?: number;
  transmission?: string;
  bags?: number;
  fuelPolicy?: string;
  mileagePolicy?: string;
  airConditioning?: boolean;
  hybrid?: boolean;
  drivetrain?: string;
  description?: string;
};

type ReturningStartResponse = {
  ok?: boolean;
  next?: "VERIFY";
  challengeToken?: string;
  error?: string;
};

type ReturningVerifyResponse = {
  ok?: boolean;
  error?: string;
  customer?: {
    customerId?: string;
    firstName?: string | null;
    lastName?: string | null;
    emailAddress?: string | null;
    phoneNumber?: string | null;
    street?: string | null;
    street2?: string | null;
    city?: string | null;
    parish?: string | null;
    country?: string | null;
    birthday?: string | null;
    driversLicenseNumber?: string | null;
    driversLicenseExpirationDate?: string | null;
  };
};

type PromoValidationResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  discountAmountCents?: number;
  isEstimate?: boolean;
};

type PricingQuoteSummary = {
  days: number;
  baseTotal: number;
  insurancePricePerDay: number;
  insuranceTotal: number;
  discountTotal: number;
  subtotal: number;
  total: number;
  amountDue: number;
  depositRequired: number;
  paidToDate: number;
  dueNow: number;
  dueOnPickup: number;
  reserveShortfall: number;
  balanceDue: number;
  paymentOption: "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";
  promoCode: string | null;
};

type PricingQuoteResponse = {
  ok?: boolean;
  error?: string;
  summary?: PricingQuoteSummary;
};

type MinimumRentalDaysResponse = {
  minimumDays?: number;
  globalDefaultDays?: number;
  error?: string;
};

type BookingCreateResponse = {
  bookingId?: string;
  bookingAccessToken?: string;
  error?: string;
};

type PublicLocationsResponse = {
  locations?: Array<{
    id?: string | null;
    label?: string;
    location_type_key?: string;
    pickup_label?: string;
    dropoff_label?: string;
    location_type?: string;
    allow_pickup?: boolean;
    allow_dropoff?: boolean;
    applies_to_pickup?: boolean;
    applies_to_dropoff?: boolean;
    field_schema?: Array<{
      key?: string;
      label?: string;
      input_type?: string;
      required?: boolean;
      applies_to?: string;
      default_source?: string | null;
    }>;
    sort_order?: number;
  }>;
};

type PublicInsuranceResponse = {
  insurance?: {
    enabled?: boolean;
    planId?: string | null;
    pricePerDayCents?: number;
    coverageCents?: number;
  };
};

type BookingWizardDraft = {
  step?: number;
  maxStepCompleted?: number;
  pickupDate?: string;
  pickupTime?: string;
  dropoffDate?: string;
  dropoffTime?: string;
  pickupLocationId?: string;
  dropoffLocationId?: string;
  pickupLocationValues?: BookingLocationFieldValueMap;
  dropoffLocationValues?: BookingLocationFieldValueMap;
  pickupCustomAddress?: string;
  dropoffCustomAddress?: string;
  pickupFlightDate?: string;
  pickupFlightTime?: string;
  pickupFlightNumber?: string;
  pickupAirline?: string;
  dropoffFlightDate?: string;
  dropoffFlightTime?: string;
  dropoffFlightNumber?: string;
  dropoffAirline?: string;
  dropoffLocationManuallyEdited?: boolean;
  selectedVehicleId?: string;
  protectionChoice?: "NONE" | "STANDARD" | null;
  insuranceSelected?: boolean;
  couponCode?: string;
  couponAppliedCode?: string | null;
  couponDiscount?: number;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  parish?: string;
  country?: string;
  birthday?: string;
  driversLicenseNumber?: string;
  driversLicenseExpirationDate?: string;
  customerId?: string | null;
  paymentOption?: "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";
  customPaymentAmount?: string;
  acceptTerms?: boolean;
};

const STEPS: Array<{ step: WizardStep; title: string }> = [
  { step: 1, title: "Dates" },
  { step: 2, title: "Vehicles" },
  { step: 3, title: "Features" },
  { step: 4, title: "Customer" },
  { step: 5, title: "Confirm" },
  { step: 6, title: "Payments" },
];
const WIZARD_DRAFT_STORAGE_KEY = "ccr_booking_wizard_draft_v1";
const WIZARD_DEBUG_ENABLED = process.env.NEXT_PUBLIC_WIZARD_DEBUG === "1";
const BACKGROUND_VEHICLE_REFRESH_INTERVAL_MS = 15000;

const bookingFieldClassName =
  "mt-2 min-w-0 w-full max-w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-sm text-[var(--ccr-text)] shadow-sm shadow-black/5 outline-none ring-[var(--ccr-accent)] transition focus:ring-2";
const bookingSoftFieldClassName =
  "mt-2 min-w-0 w-full max-w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm text-[var(--ccr-text)] shadow-sm shadow-black/5 outline-none ring-[var(--ccr-accent)] transition focus:ring-2";
const bookingReadonlyFieldClassName =
  "mt-2 min-w-0 w-full max-w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-4 py-3 text-sm text-[var(--ccr-text)] shadow-sm shadow-black/5";
const bookingPrimaryButtonClassName =
  "rounded-[1rem] bg-[var(--ccr-primary)] px-5 py-3 text-sm font-semibold text-[var(--ccr-on-primary)] transition hover:bg-[var(--ccr-primary-soft)] disabled:opacity-60";
const bookingOutlineButtonClassName =
  "rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ccr-text)] transition hover:bg-[var(--ccr-surface-soft)] disabled:opacity-40";
const bookingResetButtonClassName =
  "rounded-[1rem] border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)] disabled:opacity-40";

const DEFAULT_LOCATIONS: BookingLocationConfig[] = buildBookingLocationConfigs();

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateInputForOffset(days: number) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDaysToDateInput(value: string, days: number) {
  const base = new Date(`${value}T00:00:00`);
  if (Number.isNaN(base.getTime())) return value;
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

function combineDateTime(date: string, time: string) {
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function buildPricingQuoteKey(input: {
  vehicleId: string;
  startAt: Date;
  endAt: Date;
  insuranceSelected: boolean;
  promoCode: string | null;
  paymentOption: string;
  customPaymentAmount: string;
  customerEmail: string;
  deliverySelected: boolean;
  deliveryZoneLabel: string | null;
}) {
  return JSON.stringify({
    vehicleId: input.vehicleId,
    startAt: input.startAt.toISOString(),
    endAt: input.endAt.toISOString(),
    insuranceSelected: input.insuranceSelected,
    promoCode: input.promoCode,
    paymentOption: input.paymentOption,
    customAmount: input.paymentOption === "CUSTOM" ? input.customPaymentAmount : null,
    customerEmail: normalizeText(input.customerEmail),
    deliverySelected: input.deliverySelected,
    deliveryZoneLabel: input.deliveryZoneLabel,
  });
}

function normalizeText(value: string) {
  return value.trim();
}

function hasLocationFieldProgress(values: BookingLocationFieldValueMap | undefined) {
  if (!values || typeof values !== "object") return false;
  return Object.values(values).some((value) => normalizeText(value ?? "").length > 0);
}

function syncLocationFieldDefaults(input: {
  fields: BookingLocationFieldSchema[];
  currentValues: BookingLocationFieldValueMap;
  defaultSource:
    | "pickup_date"
    | "pickup_time"
    | "dropoff_date"
    | "dropoff_time";
  previousValue: string;
  nextValue: string;
}) {
  const nextValues = { ...input.currentValues };

  for (const field of input.fields) {
    if (field.defaultSource !== input.defaultSource) continue;
    const currentValue = normalizeText(nextValues[field.key] ?? "");
    if (!currentValue || currentValue === input.previousValue) {
      nextValues[field.key] = input.nextValue;
    }
  }

  return nextValues;
}

function displayVehicleName(vehicle: PublicVehicle) {
  const explicit = normalizeText(vehicle.name ?? "");
  if (explicit) return explicit;
  return `${vehicle.make} ${vehicle.model}`.trim();
}

function getVehicleGalleryImages(vehicle: PublicVehicle | null | undefined) {
  if (!vehicle || !Array.isArray(vehicle.images)) return ["/window.svg"];
  const images = vehicle.images
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return images.length > 0 ? images : ["/window.svg"];
}

function setIfPresent(current: string, next: string | null | undefined) {
  if (typeof next !== "string") return current;
  const value = next.trim();
  return value.length > 0 ? value : current;
}

function parseWizardStep(value: unknown): WizardStep {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5 || parsed === 6) {
    return parsed;
  }
  return 1;
}

function parseMaxStepCompleted(value: unknown): WizardStep {
  const parsed = Number(value);
  if (parsed <= 1) return 1;
  if (parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5 || parsed === 6) {
    return parsed;
  }
  return 6;
}

function draftContainsMeaningfulProgress(draft: BookingWizardDraft) {
  const step = parseWizardStep(draft.step);
  if (step > 1) return true;
  if (normalizeText(draft.selectedVehicleId ?? "").length > 0) return true;
  if (hasLocationFieldProgress(draft.pickupLocationValues)) return true;
  if (hasLocationFieldProgress(draft.dropoffLocationValues)) return true;
  if (normalizeText(draft.pickupCustomAddress ?? "").length > 0) return true;
  if (normalizeText(draft.dropoffCustomAddress ?? "").length > 0) return true;
  if (draft.protectionChoice === "NONE" || draft.protectionChoice === "STANDARD") return true;
  if (draft.insuranceSelected === true) return true;
  if (normalizeText(draft.couponCode ?? "").length > 0) return true;
  if (normalizeText(draft.couponAppliedCode ?? "").length > 0) return true;
  if ((draft.couponDiscount ?? 0) > 0) return true;
  if (normalizeText(draft.firstName ?? "").length > 0) return true;
  if (normalizeText(draft.lastName ?? "").length > 0) return true;
  if (normalizeText(draft.emailAddress ?? "").length > 0) return true;
  if (normalizeText(draft.phoneNumber ?? "").length > 0) return true;
  if (normalizeText(draft.driversLicenseNumber ?? "").length > 0) return true;
  if (normalizeText(draft.customPaymentAmount ?? "").length > 0) return true;
  if (draft.paymentOption === "FULL" || draft.paymentOption === "CUSTOM" || draft.paymentOption === "NONE") {
    return true;
  }
  return false;
}

type PublicBookingWizardProps = {
  turnstileDevBypassEnabled?: boolean;
};

type GlightboxInstance = {
  openAt: (index?: number) => void;
  destroy: () => void;
};

export function PublicBookingWizard({
  turnstileDevBypassEnabled = false,
}: PublicBookingWizardProps) {
  const router = useRouter();
  const hostedPaymentProvider =
    process.env.NEXT_PUBLIC_PAYMENT_PROVIDER?.trim().toLowerCase() === "stripe"
      ? "Stripe"
      : "WiPay";
  const checkoutStep = { step: 7, title: hostedPaymentProvider } as const;
  const [requestedVehicleFromQuery, setRequestedVehicleFromQuery] = useState("");
  const draftHydratedRef = useRef(false);
  const preselectedVehicleIdRef = useRef("");
  const initialBookingDateTimeRef = useRef(defaultBookingDateTime());
  const initialPickupDateRef = useRef(initialBookingDateTimeRef.current.pickupDate);
  const initialDropoffDateRef = useRef(initialBookingDateTimeRef.current.dropoffDate);
  const initialPickupTimeRef = useRef(initialBookingDateTimeRef.current.pickupTime);
  const initialDropoffTimeRef = useRef(initialBookingDateTimeRef.current.dropoffTime);

  const [step, setStep] = useState<WizardStep>(1);
  const [maxStepCompleted, setMaxStepCompleted] = useState<WizardStep>(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draftWasRestored, setDraftWasRestored] = useState(false);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);

  const [pickupDate, setPickupDate] = useState(() => initialPickupDateRef.current);
  const [pickupTime, setPickupTime] = useState(() => initialPickupTimeRef.current);
  const [dropoffDate, setDropoffDate] = useState(() => initialDropoffDateRef.current);
  const [dropoffTime, setDropoffTime] = useState(() => initialDropoffTimeRef.current);

  const [locationOptions, setLocationOptions] = useState<BookingLocationConfig[]>(DEFAULT_LOCATIONS);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [pickupLocationId, setPickupLocationId] = useState(
    DEFAULT_LOCATIONS[0]?.locationTypeKey ?? "OFFICE",
  );
  const [dropoffLocationId, setDropoffLocationId] = useState(
    DEFAULT_LOCATIONS[0]?.locationTypeKey ?? "OFFICE",
  );
  const [pickupLocationValues, setPickupLocationValues] = useState<BookingLocationFieldValueMap>({});
  const [dropoffLocationValues, setDropoffLocationValues] = useState<BookingLocationFieldValueMap>({});
  const [dropoffLocationManuallyEdited, setDropoffLocationManuallyEdited] = useState(false);

  const [vehicleOptions, setVehicleOptions] = useState<PublicVehicle[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicleSelectionUnavailable, setVehicleSelectionUnavailable] = useState(false);
  const [vehicleRefreshWarning, setVehicleRefreshWarning] = useState<string | null>(null);
  const [minimumRentalGlobalDays, setMinimumRentalGlobalDays] = useState(2);

  const [protectionChoice, setProtectionChoice] = useState<"NONE" | "STANDARD" | null>(null);
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [insurancePlanId, setInsurancePlanId] = useState<string | null>(null);
  const [insurancePricePerDay, setInsurancePricePerDay] = useState(0);
  const [insuranceCoverage, setInsuranceCoverage] = useState(155000);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const insuranceSelected = protectionChoice === "STANDARD";

  const [couponCode, setCouponCode] = useState("");
  const [couponAppliedCode, setCouponAppliedCode] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponBusy, setCouponBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pricingState, setPricingState] = useState(() =>
    createPricingLifecycleState<PricingQuoteSummary>(),
  );
  const selectedVehicleIdRef = useRef("");
  const wizardContainerRef = useRef<HTMLDivElement | null>(null);
  const latestVehiclesKeyRef = useRef("");
  const latestVehiclesRequestIdRef = useRef(0);
  const lastVehiclesSuccessKeyRef = useRef("");
  const inFlightVehiclesRef = useRef<{ key: string; controller: AbortController } | null>(null);
  const vehiclesRequestCountRef = useRef(0);
  const vehicleOptionsRef = useRef<PublicVehicle[]>([]);
  const vehicleLightboxRef = useRef<GlightboxInstance | null>(null);
  const latestQuoteKeyRef = useRef("");
  const lastQuoteSuccessKeyRef = useRef("");
  const inFlightQuoteRef = useRef<{ key: string; controller: AbortController } | null>(null);
  const quoteRequestCountRef = useRef(0);
  const bookingSubmissionKeyRef = useRef("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [street, setStreet] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [parish, setParish] = useState("");
  const [country, setCountry] = useState("Jamaica");
  const [birthday, setBirthday] = useState("");

  const [driversLicenseNumber, setDriversLicenseNumber] = useState("");
  const [driversLicenseExpirationDate, setDriversLicenseExpirationDate] = useState("");
  const [driversLicenseImageUrls, setDriversLicenseImageUrls] = useState<string[]>([]);
  const [driversLicenseUploading, setDriversLicenseUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showReturningCustomerModal, setShowReturningCustomerModal] = useState(false);
  const [returningDlInput, setReturningDlInput] = useState("");
  const [returningChallengeToken, setReturningChallengeToken] = useState("");
  const [returningSessionKey, setReturningSessionKey] = useState("");
  const [returningOtpCode, setReturningOtpCode] = useState("");
  const [returningLastName, setReturningLastName] = useState("");
  const [returningBusy, setReturningBusy] = useState(false);
  const [returningStage, setReturningStage] = useState<"lookup" | "verify">("lookup");
  const [returningError, setReturningError] = useState<string | null>(null);
  const [returningTurnstileToken, setReturningTurnstileToken] = useState<string | null>(null);
  const [returningTurnstileResetKey, setReturningTurnstileResetKey] = useState(0);

  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = useRef(false);
  const signatureDirtyRef = useRef(false);
  const signaturePixelRatioRef = useRef(1);
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [paymentOption, setPaymentOption] = useState<"FULL" | "DEPOSIT" | "CUSTOM" | "NONE">(
    "DEPOSIT",
  );
  const [customPaymentAmount, setCustomPaymentAmount] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const debugWizardRequest = useCallback((label: string, detail: Record<string, unknown>) => {
    if (!WIZARD_DEBUG_ENABLED || typeof window === "undefined") return;
    console.debug(`[booking-wizard] ${label}`, detail);
  }, []);

  const resetQuoteRefresh = useCallback(
    (reason: "missing_prerequisites" | "vehicle_unresolved" | "invalid_datetime") => {
      latestQuoteKeyRef.current = "";
      lastQuoteSuccessKeyRef.current = "";
      if (inFlightQuoteRef.current) {
        inFlightQuoteRef.current.controller.abort();
        inFlightQuoteRef.current = null;
      }
      setPricingState((previous) => ({
        status: "idle",
        current: null,
        lastGood: previous.lastGood,
        error: null,
      }));
      debugWizardRequest("quote:reset", { reason });
    },
    [debugWizardRequest],
  );

  const createClientSubmissionKey = useCallback(() => {
    if (typeof window === "undefined") {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const cryptoApi = window.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }

    if (typeof cryptoApi?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, []);

  const getBookingSubmissionKey = useCallback(() => {
    if (!bookingSubmissionKeyRef.current) {
      bookingSubmissionKeyRef.current = createClientSubmissionKey();
    }
    return bookingSubmissionKeyRef.current;
  }, [createClientSubmissionKey]);

  useEffect(() => {
    return () => {
      if (inFlightVehiclesRef.current) {
        inFlightVehiclesRef.current.controller.abort();
        inFlightVehiclesRef.current = null;
      }
      if (inFlightQuoteRef.current) {
        inFlightQuoteRef.current.controller.abort();
        inFlightQuoteRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem("ccr-returning-customer-session") ?? "";
    if (existing.trim()) {
      setReturningSessionKey(existing.trim());
      return;
    }

    const generated =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem("ccr-returning-customer-session", generated);
    setReturningSessionKey(generated);
  }, []);

  const clearWizardDraft = useCallback(() => {
    clearBookingDraft({ keys: [WIZARD_DRAFT_STORAGE_KEY] });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vehicle = normalizeText(new URLSearchParams(window.location.search).get("vehicle") ?? "");
    if (!vehicle) return;
    setRequestedVehicleFromQuery(vehicle);
  }, []);

  useEffect(() => {
    if (!requestedVehicleFromQuery) return;
    preselectedVehicleIdRef.current = requestedVehicleFromQuery;
    setSelectedVehicleId((current) => current || requestedVehicleFromQuery);
  }, [requestedVehicleFromQuery]);

  useEffect(() => {
    if (typeof window === "undefined" || draftHydratedRef.current) return;

    try {
      const raw = window.sessionStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as BookingWizardDraft;
      if (!draftContainsMeaningfulProgress(draft)) return;

      const restoredStep = parseWizardStep(draft.step);
      const restoredMaxStep = parseMaxStepCompleted(draft.maxStepCompleted);
      const restoredSelections = restoreSelectionFieldsFromDraft(
        draft as Record<string, unknown>,
        {
          pickupDate,
          pickupTime,
          dropoffDate,
          dropoffTime,
          pickupLocationId,
          dropoffLocationId,
          selectedVehicleId,
          insuranceSelected: protectionChoice === "STANDARD",
          paymentOption,
        },
      );
      if (
        restoredPickupIsBeforeDefault({
          pickupDate: restoredSelections.pickupDate,
          pickupTime: restoredSelections.pickupTime,
          minimumDays: minimumRentalGlobalDays,
        })
      ) {
        clearWizardDraft();
        setStatusMessage("Saved booking draft expired. Start again with current dates.");
        return;
      }
      const restoredProtectionChoice =
        draft.protectionChoice === "NONE" || draft.protectionChoice === "STANDARD"
          ? draft.protectionChoice
          : restoredSelections.insuranceSelected
            ? "STANDARD"
            : restoredStep >= 3
              ? "NONE"
              : null;
      setStep(restoredStep);
      setMaxStepCompleted(
        restoredMaxStep > restoredStep ? restoredMaxStep : restoredStep,
      );
      setPickupDate(restoredSelections.pickupDate);
      setPickupTime(restoredSelections.pickupTime);
      setDropoffDate(restoredSelections.dropoffDate);
      setDropoffTime(restoredSelections.dropoffTime);
      setPickupLocationId(
        typeof restoredSelections.pickupLocationId === "string" &&
          restoredSelections.pickupLocationId.trim()
          ? restoredSelections.pickupLocationId.trim().toUpperCase()
          : "OFFICE",
      );
      setDropoffLocationId(
        typeof restoredSelections.dropoffLocationId === "string" &&
          restoredSelections.dropoffLocationId.trim()
          ? restoredSelections.dropoffLocationId.trim().toUpperCase()
          : "OFFICE",
      );
      setSelectedVehicleId(restoredSelections.selectedVehicleId);
      setProtectionChoice(restoredProtectionChoice);
      setPaymentOption(restoredSelections.paymentOption);
      if (draft.pickupLocationValues && typeof draft.pickupLocationValues === "object") {
        setPickupLocationValues(draft.pickupLocationValues);
      } else {
        setPickupLocationValues({
          address: typeof draft.pickupCustomAddress === "string" ? draft.pickupCustomAddress : null,
          flight_date:
            typeof draft.pickupFlightDate === "string" ? draft.pickupFlightDate : null,
          flight_time:
            typeof draft.pickupFlightTime === "string" ? draft.pickupFlightTime : null,
          flight_number:
            typeof draft.pickupFlightNumber === "string" ? draft.pickupFlightNumber : null,
          airline: typeof draft.pickupAirline === "string" ? draft.pickupAirline : null,
        });
      }
      if (draft.dropoffLocationValues && typeof draft.dropoffLocationValues === "object") {
        setDropoffLocationValues(draft.dropoffLocationValues);
      } else {
        setDropoffLocationValues({
          address:
            typeof draft.dropoffCustomAddress === "string" ? draft.dropoffCustomAddress : null,
          flight_date:
            typeof draft.dropoffFlightDate === "string" ? draft.dropoffFlightDate : null,
          flight_time:
            typeof draft.dropoffFlightTime === "string" ? draft.dropoffFlightTime : null,
          flight_number:
            typeof draft.dropoffFlightNumber === "string" ? draft.dropoffFlightNumber : null,
          airline: typeof draft.dropoffAirline === "string" ? draft.dropoffAirline : null,
        });
      }
      if (typeof draft.dropoffLocationManuallyEdited === "boolean") {
        setDropoffLocationManuallyEdited(draft.dropoffLocationManuallyEdited);
      }
      if (typeof draft.couponCode === "string") setCouponCode(draft.couponCode);
      if (typeof draft.couponAppliedCode === "string" || draft.couponAppliedCode === null) {
        setCouponAppliedCode(draft.couponAppliedCode ?? null);
      }
      if (typeof draft.couponDiscount === "number" && Number.isFinite(draft.couponDiscount)) {
        setCouponDiscount(Math.max(0, Math.round(draft.couponDiscount)));
      }
      if (typeof draft.firstName === "string") setFirstName(draft.firstName);
      if (typeof draft.lastName === "string") setLastName(draft.lastName);
      if (typeof draft.emailAddress === "string") setEmailAddress(draft.emailAddress);
      if (typeof draft.phoneNumber === "string") setPhoneNumber(draft.phoneNumber);
      if (typeof draft.street === "string") setStreet(draft.street);
      if (typeof draft.street2 === "string") setStreet2(draft.street2);
      if (typeof draft.city === "string") setCity(draft.city);
      const legacyCountryParish =
        typeof draft.country === "string" ? normalizeJamaicaParish(draft.country) : null;
      const restoredCountry = legacyCountryParish
        ? "Jamaica"
        : normalizeCountryName(draft.country) ?? "Jamaica";
      setCountry(restoredCountry);
      const restoredParish =
        (typeof draft.parish === "string" && draft.parish.trim()) ||
        (typeof draft.state === "string" && draft.state.trim()) ||
        (typeof draft.country === "string" && normalizeJamaicaParish(draft.country)) ||
        null;
      if (restoredParish) setParish(restoredParish);
      if (typeof draft.birthday === "string") setBirthday(draft.birthday);
      if (typeof draft.driversLicenseNumber === "string") setDriversLicenseNumber(draft.driversLicenseNumber);
      if (typeof draft.driversLicenseExpirationDate === "string") {
        setDriversLicenseExpirationDate(draft.driversLicenseExpirationDate);
      }
      if (typeof draft.customerId === "string" || draft.customerId === null) {
        setCustomerId(draft.customerId ?? null);
      }
      if (typeof draft.customPaymentAmount === "string") setCustomPaymentAmount(draft.customPaymentAmount);
      if (typeof draft.acceptTerms === "boolean") setAcceptTerms(draft.acceptTerms);

      // For security, DL uploads and signatures are never restored from browser storage.
      const security = draftRestoreSecurityState();
      setDriversLicenseImageUrls(security.driversLicenseImageUrls);
      setSignatureDataUrl(security.signatureDataUrl);
      if (security.requiresDriversLicenseUpload || security.requiresSignatureUpload) {
        setStatusMessage(security.notice);
      }
      setDraftWasRestored(true);
    } catch {
      // Ignore invalid draft payloads.
    } finally {
      draftHydratedRef.current = true;
      setHydrated(true);
    }
  }, [
    clearWizardDraft,
    dropoffDate,
    dropoffLocationId,
    dropoffTime,
    minimumRentalGlobalDays,
    paymentOption,
    protectionChoice,
    pickupDate,
    pickupLocationId,
    pickupTime,
    selectedVehicleId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !hydrated) return;

    const draft: BookingWizardDraft = {
      step,
      maxStepCompleted,
      pickupDate,
      pickupTime,
      dropoffDate,
      dropoffTime,
      pickupLocationId,
      dropoffLocationId,
      pickupLocationValues,
      dropoffLocationValues,
      dropoffLocationManuallyEdited,
      selectedVehicleId,
      protectionChoice,
      insuranceSelected,
      couponCode,
      couponAppliedCode,
      couponDiscount,
      firstName,
      lastName,
      emailAddress,
      phoneNumber,
      street,
      street2,
      city,
      parish,
      country,
      birthday,
      driversLicenseNumber,
      driversLicenseExpirationDate,
      customerId,
      paymentOption,
      customPaymentAmount,
      acceptTerms,
    };

    const shouldPersistDraft =
      step > 1 ||
      pickupDate !== initialPickupDateRef.current ||
      pickupTime !== initialPickupTimeRef.current ||
      dropoffDate !== initialDropoffDateRef.current ||
      dropoffTime !== initialDropoffTimeRef.current ||
      Object.values(pickupLocationValues).some((value) => normalizeText(value ?? "").length > 0) ||
      Object.values(dropoffLocationValues).some((value) => normalizeText(value ?? "").length > 0) ||
      normalizeText(selectedVehicleId).length > 0 ||
      protectionChoice !== null ||
      insuranceSelected ||
      normalizeText(couponCode).length > 0 ||
      normalizeText(couponAppliedCode ?? "").length > 0 ||
      couponDiscount > 0 ||
      normalizeText(firstName).length > 0 ||
      normalizeText(lastName).length > 0 ||
      normalizeText(emailAddress).length > 0 ||
      normalizeText(phoneNumber).length > 0 ||
      normalizeText(parish).length > 0 ||
      (normalizeText(country).length > 0 && country !== "Jamaica") ||
      normalizeText(driversLicenseNumber).length > 0 ||
      normalizeText(customPaymentAmount).length > 0 ||
      paymentOption !== "DEPOSIT" ||
      acceptTerms;

    if (!shouldPersistDraft) {
      clearWizardDraft();
      return;
    }
    window.sessionStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [
    acceptTerms,
    birthday,
    city,
    country,
    couponAppliedCode,
    couponCode,
    couponDiscount,
    customerId,
    customPaymentAmount,
    driversLicenseExpirationDate,
    driversLicenseNumber,
    dropoffDate,
    dropoffLocationId,
    dropoffLocationManuallyEdited,
    dropoffLocationValues,
    dropoffTime,
    emailAddress,
    firstName,
    insuranceSelected,
    lastName,
    paymentOption,
    parish,
    phoneNumber,
    pickupDate,
    pickupLocationId,
    pickupLocationValues,
    pickupTime,
    protectionChoice,
    selectedVehicleId,
    step,
    maxStepCompleted,
    hydrated,
    street,
    street2,
    clearWizardDraft,
  ]);

  const pickupOptions = useMemo(
    () => getBookingLocationConfigsForSide(locationOptions, "pickup").filter((location) => location.isActive),
    [locationOptions],
  );
  const dropoffOptions = useMemo(
    () => getBookingLocationConfigsForSide(locationOptions, "dropoff").filter((location) => location.isActive),
    [locationOptions],
  );
  const pickupLocationConfig = useMemo(
    () =>
      getBookingLocationConfigByType(pickupOptions, pickupLocationId, "pickup") ??
      getBookingLocationConfigByType(DEFAULT_LOCATIONS, pickupLocationId, "pickup") ??
      DEFAULT_LOCATIONS[0],
    [pickupLocationId, pickupOptions],
  );
  const dropoffLocationConfig = useMemo(
    () =>
      getBookingLocationConfigByType(dropoffOptions, dropoffLocationId, "dropoff") ??
      getBookingLocationConfigByType(DEFAULT_LOCATIONS, dropoffLocationId, "dropoff") ??
      DEFAULT_LOCATIONS[0],
    [dropoffLocationId, dropoffOptions],
  );
  const pickupFieldSchema = useMemo(
    () => getBookingLocationFieldSchemaForSide(pickupLocationConfig, "pickup"),
    [pickupLocationConfig],
  );
  const dropoffFieldSchema = useMemo(
    () => getBookingLocationFieldSchemaForSide(dropoffLocationConfig, "dropoff"),
    [dropoffLocationConfig],
  );
  const locationDefaultsContext = useMemo(
    () => ({
      pickupDate,
      pickupTime,
      dropoffDate,
      dropoffTime,
    }),
    [dropoffDate, dropoffTime, pickupDate, pickupTime],
  );

  const selectedVehicle = useMemo(
    () => vehicleOptions.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [vehicleOptions, selectedVehicleId],
  );
  const effectiveMinimumRentalDays = minimumRentalGlobalDays;
  const hasSelectedVehicleId = normalizeText(selectedVehicleId).length > 0;
  const hasResolvedVehicle =
    hasSelectedVehicleId && selectedVehicle !== null && !vehicleSelectionUnavailable;
  const pricingQuote = displayPricingSnapshot(pricingState);
  const pricingQuoteLoading = pricingIsLoadingWithoutSnapshot(pricingState);
  const pricingQuoteUpdating = pricingIsUpdatingWithSnapshot(pricingState);
  const pricingQuoteError = pricingState.status === "error" ? pricingState.error : null;

  useEffect(() => {
    selectedVehicleIdRef.current = selectedVehicleId;
  }, [selectedVehicleId]);

  useEffect(() => {
    vehicleOptionsRef.current = vehicleOptions;
  }, [vehicleOptions]);

  useEffect(() => {
    let cancelled = false;
    async function loadMinimumRentalDays() {
      try {
        const response = await fetch("/api/public/minimum-rental-days", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as MinimumRentalDaysResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load minimum rental days.");
        }
        if (cancelled) return;

        const globalDefaultDays = Number(data.globalDefaultDays ?? data.minimumDays ?? 2);
        setMinimumRentalGlobalDays(
          Number.isFinite(globalDefaultDays) ? Math.max(1, Math.floor(globalDefaultDays)) : 2,
        );
      } catch {
        if (!cancelled) {
          setMinimumRentalGlobalDays(2);
        }
      }
    }

    void loadMinimumRentalDays();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || draftWasRestored || step !== 1) return;
    const stillUsingInitialDefaults =
      pickupDate === initialPickupDateRef.current &&
      pickupTime === initialPickupTimeRef.current &&
      dropoffDate === initialDropoffDateRef.current &&
      dropoffTime === initialDropoffTimeRef.current;
    if (!stillUsingInitialDefaults) return;

    const defaultDateTime = defaultBookingDateTime({ minimumDays: minimumRentalGlobalDays });
    const unchanged =
      defaultDateTime.pickupDate === initialPickupDateRef.current &&
      defaultDateTime.pickupTime === initialPickupTimeRef.current &&
      defaultDateTime.dropoffDate === initialDropoffDateRef.current &&
      defaultDateTime.dropoffTime === initialDropoffTimeRef.current;
    if (unchanged) return;

    initialBookingDateTimeRef.current = defaultDateTime;
    initialPickupDateRef.current = defaultDateTime.pickupDate;
    initialDropoffDateRef.current = defaultDateTime.dropoffDate;
    initialPickupTimeRef.current = defaultDateTime.pickupTime;
    initialDropoffTimeRef.current = defaultDateTime.dropoffTime;
    setPickupDate(defaultDateTime.pickupDate);
    setPickupTime(defaultDateTime.pickupTime);
    setDropoffDate(defaultDateTime.dropoffDate);
    setDropoffTime(defaultDateTime.dropoffTime);
  }, [
    draftWasRestored,
    dropoffDate,
    dropoffTime,
    hydrated,
    minimumRentalGlobalDays,
    pickupDate,
    pickupTime,
    step,
  ]);

  const destroyVehicleLightbox = useCallback(() => {
    if (!vehicleLightboxRef.current) return;
    vehicleLightboxRef.current.destroy();
    vehicleLightboxRef.current = null;
  }, []);

  const openVehicleLightbox = useCallback(
    async (vehicleId: string, startIndex = 0) => {
      const vehicle = vehicleOptionsRef.current.find((option) => option.id === vehicleId) ?? null;
      if (!vehicle) return;

      const images = getVehicleGalleryImages(vehicle);
      const boundedIndex = Math.max(0, Math.min(images.length - 1, Math.trunc(startIndex)));
      const vehicleName = displayVehicleName(vehicle) || "Vehicle";
      const elements = images.map((href, index) => ({
        href,
        type: "image" as const,
        title: vehicleName,
        description: `${index + 1} of ${images.length}`,
      }));

      try {
        const glightboxModule = await import("glightbox");
        const createGlightbox = ((glightboxModule as unknown as { default?: unknown }).default ??
          glightboxModule) as unknown as (options: Record<string, unknown>) => GlightboxInstance;

        destroyVehicleLightbox();
        const instance = createGlightbox({
          elements,
          loop: images.length > 1,
          touchNavigation: true,
          keyboardNavigation: true,
          closeOnOutsideClick: true,
          closeButton: true,
          openEffect: "slide",
          closeEffect: "fade",
          slideEffect: "slide",
          moreLength: 0,
          draggable: true,
          zoomable: true,
          skin: "clean",
        });
        vehicleLightboxRef.current = instance;
        instance.openAt(boundedIndex);
      } catch {
        setErrorMessage("Unable to open image gallery. Please try again.");
      }
    },
    [destroyVehicleLightbox],
  );

  useEffect(() => () => {
    destroyVehicleLightbox();
  }, [destroyVehicleLightbox]);

  const rentalDays = pricingQuote?.days ?? calcRentalDays(pickupDate, dropoffDate);
  const standardProtectionAvailable = insuranceEnabled && !insuranceLoading;
  const standardProtectionTotal = rentalDays * insurancePricePerDay;
  const baseTotal = pricingQuote?.baseTotal ?? (selectedVehicle ? selectedVehicle.daily_rate_cents * rentalDays : 0);
  const insuranceTotal = pricingQuote?.insuranceTotal ?? (insuranceSelected ? rentalDays * insurancePricePerDay : 0);
  const discountTotal = pricingQuote?.discountTotal ?? Math.max(0, Math.min(baseTotal + insuranceTotal, couponDiscount));
  const amountDue = pricingQuote?.amountDue ?? Math.max(0, baseTotal + insuranceTotal - discountTotal);
  const depositRequired = pricingQuote?.depositRequired ?? (selectedVehicle ? selectedVehicle.deposit_cents : 0);
  const refundableSecurityDepositJmd =
    selectedVehicle && typeof selectedVehicle.security_deposit_jmd === "number"
      ? selectedVehicle.security_deposit_jmd
      : 0;

  const customPaymentNumber = Number(customPaymentAmount);
  const customPaymentIsValid =
    Number.isFinite(customPaymentNumber) && customPaymentNumber > 0 && customPaymentNumber <= amountDue;
  const paymentPreviewDueNow =
    pricingQuote?.dueNow ??
    (paymentOption === "FULL"
      ? amountDue
      : paymentOption === "DEPOSIT"
        ? Math.min(amountDue, depositRequired)
        : paymentOption === "CUSTOM" && customPaymentIsValid
          ? customPaymentNumber
          : 0);
  const reserveShortfall =
    pricingQuote?.reserveShortfall ?? Math.max(0, depositRequired - paymentPreviewDueNow);
  const balanceDueOnPickup =
    pricingQuote?.dueOnPickup ?? Math.max(0, amountDue - paymentPreviewDueNow);

  const pickupAt = combineDateTime(pickupDate, pickupTime);
  const dropoffAt = combineDateTime(dropoffDate, dropoffTime);
  const dateWindowError =
    !pickupAt || !dropoffAt
      ? "Select valid pickup and return date/time."
      : dropoffAt <= pickupAt
        ? "Return date and time must be later than pickup date and time."
        : (() => {
            const minimumValidation = validateMinimumRentalDays({
              start: pickupAt,
              end: dropoffAt,
              minimumDays: effectiveMinimumRentalDays,
            });
            return minimumValidation.ok ? null : minimumValidation.message;
          })();
  const datesValid = dateWindowError === null;

  const pickupLocationText = useMemo(
    () => getBookingLocationSnapshotText(pickupLocationConfig, "pickup", pickupLocationValues),
    [pickupLocationConfig, pickupLocationValues],
  );

  const dropoffLocationText = useMemo(
    () => getBookingLocationSnapshotText(dropoffLocationConfig, "dropoff", dropoffLocationValues),
    [dropoffLocationConfig, dropoffLocationValues],
  );
  const deliverySelected =
    pickupFieldSchema.some((field) => field.key === "address") ||
    dropoffFieldSchema.some((field) => field.key === "address");
  const deliveryZoneLabel = [pickupLocationText, dropoffLocationText].filter(Boolean).join(" → ");
  const currentPricingQuoteKey = useMemo(() => {
    if (!hasSelectedVehicleId || !pickupAt || !dropoffAt || !datesValid) return "";
    return buildPricingQuoteKey({
      vehicleId: selectedVehicleId,
      startAt: pickupAt,
      endAt: dropoffAt,
      insuranceSelected: insuranceEnabled && insuranceSelected,
      promoCode: couponAppliedCode,
      paymentOption,
      customPaymentAmount,
      customerEmail: emailAddress,
      deliverySelected,
      deliveryZoneLabel: deliveryZoneLabel || null,
    });
  }, [
    couponAppliedCode,
    customPaymentAmount,
    datesValid,
    deliverySelected,
    deliveryZoneLabel,
    dropoffAt,
    emailAddress,
    hasSelectedVehicleId,
    insuranceEnabled,
    insuranceSelected,
    paymentOption,
    pickupAt,
    selectedVehicleId,
  ]);
  const pricingQuoteReadyForCurrentSelection =
    Boolean(pricingQuote) &&
    Boolean(currentPricingQuoteKey) &&
    pricingState.status === "ready" &&
    lastQuoteSuccessKeyRef.current === currentPricingQuoteKey;

  const loadAvailableVehicles = useCallback(
    async (options?: {
      reason?: "effect" | "revalidate" | "select" | "background";
      force?: boolean;
    }) => {
      const reason = options?.reason ?? "effect";
      if (!pickupDate || !dropoffDate || !datesValid) {
        latestVehiclesRequestIdRef.current = 0;
        latestVehiclesKeyRef.current = "";
        lastVehiclesSuccessKeyRef.current = "";
        if (inFlightVehiclesRef.current) {
          inFlightVehiclesRef.current.controller.abort();
          inFlightVehiclesRef.current = null;
        }
        setVehicleOptions([]);
        setVehicleSelectionUnavailable(false);
        setVehicleRefreshWarning(null);
        debugWizardRequest("vehicles:reset", { reason });
        return [];
      }

      const vehiclesKey = JSON.stringify({
        pickupDate,
        pickupTime,
        dropoffDate,
        dropoffTime,
        pickupLocationId,
        dropoffLocationId,
      });
      latestVehiclesKeyRef.current = vehiclesKey;

      if (inFlightVehiclesRef.current?.key === vehiclesKey) {
        if (options?.force) {
          inFlightVehiclesRef.current.controller.abort();
          inFlightVehiclesRef.current = null;
          debugWizardRequest("vehicles:abort:force_refresh", { key: vehiclesKey, reason });
        } else {
          debugWizardRequest("vehicles:skip:inflight", { key: vehiclesKey, reason });
          return vehicleOptionsRef.current;
        }
      }

      if (
        !options?.force &&
        lastVehiclesSuccessKeyRef.current === vehiclesKey
      ) {
        debugWizardRequest("vehicles:skip:dedupe", { key: vehiclesKey, reason });
        return vehicleOptionsRef.current;
      }

      if (inFlightVehiclesRef.current && inFlightVehiclesRef.current.key !== vehiclesKey) {
        inFlightVehiclesRef.current.controller.abort();
        inFlightVehiclesRef.current = null;
      }

      const controller = new AbortController();
      inFlightVehiclesRef.current = { key: vehiclesKey, controller };
      const requestCount = vehiclesRequestCountRef.current + 1;
      vehiclesRequestCountRef.current = requestCount;
      const requestId = latestVehiclesRequestIdRef.current + 1;
      latestVehiclesRequestIdRef.current = requestId;
      debugWizardRequest("vehicles:start", {
        key: vehiclesKey,
        reason,
        count: requestCount,
        requestId,
      });

      try {
        const response = await fetch(
          `/api/public/vehicles?pickupDate=${encodeURIComponent(
            pickupDate,
          )}&pickupTime=${encodeURIComponent(pickupTime)}&dropoffDate=${encodeURIComponent(
            dropoffDate,
          )}&dropoffTime=${encodeURIComponent(dropoffTime)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json().catch(() => ({}))) as {
          vehicles?: Array<Record<string, unknown>>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load available vehicles.");
        }

        const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
        const mapped = vehicles
          .filter(
            (vehicle): vehicle is Record<string, unknown> =>
              typeof vehicle.id === "string" &&
              typeof vehicle.make === "string" &&
              typeof vehicle.model === "string",
          )
          .map((vehicle) => ({
            id: String(vehicle.id),
            name: typeof vehicle.name === "string" ? vehicle.name : "",
            make: String(vehicle.make),
            model: String(vehicle.model),
            year: typeof vehicle.year === "number" ? vehicle.year : 0,
            daily_rate_cents:
              typeof vehicle.daily_rate_cents === "number" ? vehicle.daily_rate_cents : 0,
            deposit_cents: typeof vehicle.deposit_cents === "number" ? vehicle.deposit_cents : 0,
            security_deposit_jmd:
              typeof vehicle.security_deposit_jmd === "number"
                ? vehicle.security_deposit_jmd
                : null,
            images: Array.isArray(vehicle.images)
              ? vehicle.images.filter((image): image is string => typeof image === "string")
              : [],
            category: typeof vehicle.category === "string" ? vehicle.category : "",
            seats: typeof vehicle.seats === "number" ? vehicle.seats : 0,
            doors:
              typeof vehicle.doors === "number"
                ? vehicle.doors
                : typeof vehicle.door_count === "number"
                  ? vehicle.door_count
                  : 0,
            transmission:
              typeof vehicle.transmission === "string" ? vehicle.transmission : "",
            bags: typeof vehicle.bags === "number" ? vehicle.bags : 0,
            fuelPolicy:
              typeof vehicle.fuelPolicy === "string"
                ? vehicle.fuelPolicy
                : typeof vehicle.fuel_policy === "string"
                  ? vehicle.fuel_policy
                  : "",
            mileagePolicy:
              typeof vehicle.mileagePolicy === "string"
                ? vehicle.mileagePolicy
                : typeof vehicle.mileage_policy === "string"
                  ? vehicle.mileage_policy
                  : "",
            airConditioning:
              typeof vehicle.airConditioning === "boolean"
                ? vehicle.airConditioning
                : typeof vehicle.air_conditioning === "boolean"
                  ? vehicle.air_conditioning
                  : undefined,
            hybrid:
              typeof vehicle.hybrid === "boolean"
                ? vehicle.hybrid
                : typeof vehicle.is_hybrid === "boolean"
                  ? vehicle.is_hybrid
                  : undefined,
            drivetrain:
              typeof vehicle.drivetrain === "string"
                ? vehicle.drivetrain
                : typeof vehicle.drive === "string"
                  ? vehicle.drive
                  : "",
            description:
              typeof vehicle.description === "string" ? vehicle.description : "",
          }));

        let nextSelectedVehicleId = selectedVehicleIdRef.current;

        const pendingPreselect = preselectedVehicleIdRef.current;
        if (pendingPreselect && nextSelectedVehicleId && nextSelectedVehicleId === pendingPreselect) {
          preselectedVehicleIdRef.current = "";
        }
        if (!nextSelectedVehicleId && pendingPreselect) {
          if (mapped.some((vehicle) => vehicle.id === pendingPreselect)) {
            nextSelectedVehicleId = pendingPreselect;
            setStatusMessage("Vehicle preselected from your fleet selection.");
            setErrorMessage(null);
          } else {
            setStatusMessage(null);
            setErrorMessage("Requested vehicle is unavailable for the selected pickup/dropoff window.");
          }
          preselectedVehicleIdRef.current = "";
        }

        if (latestVehiclesKeyRef.current !== vehiclesKey) {
          debugWizardRequest("vehicles:skip:stale", {
            key: vehiclesKey,
            reason,
            count: requestCount,
            requestId,
          });
          return mapped;
        }

        if (latestVehiclesRequestIdRef.current !== requestId) {
          debugWizardRequest("vehicles:skip:outdated_request", {
            key: vehiclesKey,
            reason,
            count: requestCount,
            requestId,
          });
          return mapped;
        }

        const refreshState = reconcileVehicleRefreshState({
          previousVehicles: vehicleOptionsRef.current,
          nextVehicles: mapped,
          selectedVehicleId: nextSelectedVehicleId,
        });

        lastVehiclesSuccessKeyRef.current = vehiclesKey;
        if (refreshState.inventoryChanged) {
          setVehicleOptions(refreshState.vehicleOptions);
        }
        setVehicleSelectionUnavailable(refreshState.vehicleSelectionUnavailable);
        setSelectedVehicleId(nextSelectedVehicleId);
        setVehicleRefreshWarning(null);
        debugWizardRequest("vehicles:success", {
          key: vehiclesKey,
          reason,
          count: requestCount,
          requestId,
          matched: mapped.length,
        });
        return mapped;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          debugWizardRequest("vehicles:aborted", {
            key: vehiclesKey,
            reason,
            count: requestCount,
          });
          return vehicleOptionsRef.current;
        }
        const message = error instanceof Error ? error.message : "unknown error";
        debugWizardRequest("vehicles:error", {
          key: vehiclesKey,
          reason,
          count: requestCount,
          message,
        });
        throw error;
      } finally {
        if (inFlightVehiclesRef.current?.key === vehiclesKey) {
          inFlightVehiclesRef.current = null;
        }
      }
    },
    [
      datesValid,
      debugWizardRequest,
      dropoffDate,
      dropoffLocationId,
      dropoffTime,
      pickupDate,
      pickupLocationId,
      pickupTime,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadLocations() {
      setLocationsLoading(true);
      try {
        const response = await fetch("/api/public/locations", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as PublicLocationsResponse;
        if (!response.ok) {
          throw new Error("Unable to load locations.");
        }

        const parsedLocations: BookingLocationConfig[] = Array.isArray(data.locations)
          ? data.locations
              .reduce<BookingLocationConfig[]>((accumulator, location) => {
                const locationTypeKey =
                  (typeof location.location_type_key === "string" && location.location_type_key.trim()) ||
                  (typeof location.location_type === "string" && location.location_type.trim()) ||
                  "";
                if (!locationTypeKey) return accumulator;
                const fallback =
                  DEFAULT_LOCATIONS.find(
                    (item) => item.locationTypeKey === locationTypeKey,
                  ) ?? null;
                accumulator.push({
                  id: typeof location.id === "string" && location.id.trim() ? location.id.trim() : null,
                  locationType: locationTypeKey,
                  locationTypeKey,
                  label:
                    typeof location.label === "string" && location.label.trim()
                      ? location.label.trim()
                      : fallback?.label ?? locationTypeKey,
                  pickupLabel:
                    typeof location.pickup_label === "string" && location.pickup_label.trim()
                      ? location.pickup_label.trim()
                      : fallback?.pickupLabel ?? locationTypeKey,
                  dropoffLabel:
                    typeof location.dropoff_label === "string" && location.dropoff_label.trim()
                      ? location.dropoff_label.trim()
                      : fallback?.dropoffLabel ?? locationTypeKey,
                  allowPickup: location.allow_pickup !== false,
                  allowDropoff: location.allow_dropoff !== false,
                  appliesToPickup: location.applies_to_pickup !== false,
                  appliesToDropoff: location.applies_to_dropoff !== false,
                  isActive: true,
                  sortOrder: typeof location.sort_order === "number" ? location.sort_order : fallback?.sortOrder ?? 0,
                  fieldSchema: Array.isArray(location.field_schema)
                    ? location.field_schema
                        .map((field) => {
                          if (
                            typeof field?.key !== "string" ||
                            typeof field?.label !== "string" ||
                            (field.input_type !== "text" &&
                              field.input_type !== "date" &&
                              field.input_type !== "time") ||
                            (field.applies_to !== "pickup" &&
                              field.applies_to !== "dropoff" &&
                              field.applies_to !== "both")
                          ) {
                            return null;
                          }
                          return {
                            key: field.key,
                            label: field.label,
                            inputType: field.input_type,
                            required: field.required === true,
                            appliesTo: field.applies_to,
                            defaultSource:
                              field.default_source === "pickup_date" ||
                              field.default_source === "pickup_time" ||
                              field.default_source === "dropoff_date" ||
                              field.default_source === "dropoff_time"
                                ? field.default_source
                                : null,
                          } satisfies BookingLocationFieldSchema;
                        })
                        .filter((field): field is BookingLocationFieldSchema => field !== null)
                    : fallback?.fieldSchema ?? [],
                  dbBacked:
                    typeof location.id === "string" && location.id.trim().length > 0,
                });
                return accumulator;
              }, [])
              .sort((left, right) => left.sortOrder - right.sortOrder)
          : [];

        const next = parsedLocations.length > 0 ? parsedLocations : DEFAULT_LOCATIONS;
        if (cancelled) return;
        setLocationOptions(next);

        setPickupLocationId((current) =>
          next.some((location) => location.locationTypeKey === current)
            ? current
            : (next.find((location) => location.allowPickup)?.locationTypeKey ?? "OFFICE"),
        );
        setDropoffLocationId((current) =>
          next.some((location) => location.locationTypeKey === current)
            ? current
            : (next.find((location) => location.allowDropoff)?.locationTypeKey ?? "OFFICE"),
        );
      } catch {
        if (cancelled) return;
        setLocationOptions(DEFAULT_LOCATIONS);
      } finally {
        if (!cancelled) setLocationsLoading(false);
      }
    }

    void loadLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPickupLocationValues((current) =>
      coerceBookingLocationFieldValues(
        pickupLocationConfig,
        "pickup",
        current,
        locationDefaultsContext,
      ),
    );
  }, [locationDefaultsContext, pickupLocationConfig]);

  useEffect(() => {
    if (dropoffLocationManuallyEdited) {
      setDropoffLocationValues((current) =>
        coerceBookingLocationFieldValues(
          dropoffLocationConfig,
          "dropoff",
          current,
          locationDefaultsContext,
        ),
      );
      return;
    }

    const nextTypeKey =
      pickupLocationConfig && dropoffOptions.some((location) => location.locationTypeKey === pickupLocationConfig.locationTypeKey)
        ? pickupLocationConfig.locationTypeKey
        : (dropoffOptions[0]?.locationTypeKey ?? pickupLocationConfig?.locationTypeKey ?? "OFFICE");
    setDropoffLocationId(nextTypeKey);
    setDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffOptions, nextTypeKey, "dropoff"),
        "dropoff",
        pickupLocationValues.address ? { address: pickupLocationValues.address } : {},
        locationDefaultsContext,
      ),
    );
  }, [
    dropoffLocationConfig,
    dropoffLocationManuallyEdited,
    dropoffOptions,
    locationDefaultsContext,
    pickupLocationConfig,
    pickupLocationValues.address,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadInsurance() {
      if (!hydrated) return;
      if (!selectedVehicleId) {
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
        setInsuranceCoverage(155000);
        setProtectionChoice(null);
        return;
      }
      if (!selectedVehicle || vehicleSelectionUnavailable) {
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
        setInsuranceCoverage(155000);
        return;
      }

      setInsuranceLoading(true);
      try {
        const response = await fetch(
          `/api/public/insurance?vehicleId=${encodeURIComponent(selectedVehicleId)}`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => ({}))) as PublicInsuranceResponse;
        if (!response.ok) {
          throw new Error("Unable to load insurance options.");
        }

        const enabled = data.insurance?.enabled === true;
        const price = Number(data.insurance?.pricePerDayCents ?? 0);
        const coverage = Number(data.insurance?.coverageCents ?? 155000);
        if (cancelled) return;

        setInsuranceEnabled(enabled);
        setInsurancePlanId(
          typeof data.insurance?.planId === "string" && data.insurance.planId.trim()
            ? data.insurance.planId
            : null,
        );
        setInsurancePricePerDay(
          Number.isFinite(price) && price > 0 ? Math.round(price) : 0,
        );
        setInsuranceCoverage(
          Number.isFinite(coverage) && coverage > 0 ? Math.round(coverage) : 155000,
        );
        if (!enabled) {
          setProtectionChoice((current) => (current === "STANDARD" ? null : current));
        }
      } catch {
        if (cancelled) return;
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
        setInsuranceCoverage(155000);
        setProtectionChoice((current) => (current === "STANDARD" ? null : current));
      } finally {
        if (!cancelled) setInsuranceLoading(false);
      }
    }

    void loadInsurance();
    return () => {
      cancelled = true;
    };
  }, [hydrated, selectedVehicle, selectedVehicleId, vehicleSelectionUnavailable]);

  useEffect(() => {
    if (!hydrated) return;
    if (!hasSelectedVehicleId || !datesValid) {
      resetQuoteRefresh("missing_prerequisites");
      return;
    }

    if (!hasResolvedVehicle) {
      resetQuoteRefresh("vehicle_unresolved");
      return;
    }

    const pickup = combineDateTime(pickupDate, pickupTime);
    const dropoff = combineDateTime(dropoffDate, dropoffTime);
    if (!pickup || !dropoff) {
      resetQuoteRefresh("invalid_datetime");
      return;
    }

    const quoteKey = buildPricingQuoteKey({
      vehicleId: selectedVehicleId,
      startAt: pickup,
      endAt: dropoff,
      insuranceSelected: insuranceEnabled && insuranceSelected,
      promoCode: couponAppliedCode,
      paymentOption,
      customPaymentAmount,
      customerEmail: emailAddress,
      deliverySelected,
      deliveryZoneLabel: deliveryZoneLabel || null,
    });
    latestQuoteKeyRef.current = quoteKey;

    if (lastQuoteSuccessKeyRef.current === quoteKey) {
      debugWizardRequest("quote:skip:dedupe", { key: quoteKey });
      return;
    }

    if (inFlightQuoteRef.current?.key === quoteKey) {
      debugWizardRequest("quote:skip:inflight", { key: quoteKey });
      return;
    }

    if (inFlightQuoteRef.current && inFlightQuoteRef.current.key !== quoteKey) {
      inFlightQuoteRef.current.controller.abort();
      inFlightQuoteRef.current = null;
    }

    const controller = new AbortController();
    inFlightQuoteRef.current = { key: quoteKey, controller };
    const requestCount = quoteRequestCountRef.current + 1;
    quoteRequestCountRef.current = requestCount;
    setPricingState((previous) => startPricingLifecycleRefresh(previous));
    debugWizardRequest("quote:start", {
      key: quoteKey,
      count: requestCount,
    });

    void (async () => {
      try {
        const response = await fetch("/api/public/pricing/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            vehicleId: selectedVehicleId,
            startAt: pickup.toISOString(),
            endAt: dropoff.toISOString(),
            insuranceSelected: insuranceEnabled && insuranceSelected,
            promoCode: couponAppliedCode,
            paymentOption,
            customAmount: paymentOption === "CUSTOM" ? customPaymentAmount : undefined,
            customerEmail: normalizeText(emailAddress),
            deliverySelected,
            deliveryZoneLabel: deliveryZoneLabel || null,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as PricingQuoteResponse;
        if (latestQuoteKeyRef.current !== quoteKey) {
          debugWizardRequest("quote:skip:stale", {
            key: quoteKey,
            count: requestCount,
          });
          return;
        }
        if (!response.ok || !data.ok || !data.summary) {
          throw new Error(data.error ?? "Unable to refresh pricing.");
        }
        lastQuoteSuccessKeyRef.current = quoteKey;
        setPricingState(resolvePricingLifecycleSuccess(data.summary));
        debugWizardRequest("quote:success", {
          key: quoteKey,
          count: requestCount,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          debugWizardRequest("quote:aborted", {
            key: quoteKey,
            count: requestCount,
          });
          return;
        }
        if (latestQuoteKeyRef.current !== quoteKey) return;
        const message = error instanceof Error ? error.message : "unknown error";
        setPricingState((previous) =>
          resolvePricingLifecycleError(
            previous,
            "Live pricing quote is temporarily unavailable. Totals will be revalidated before payment.",
          ),
        );
        debugWizardRequest("quote:error", {
          key: quoteKey,
          count: requestCount,
          message,
        });
      } finally {
        if (inFlightQuoteRef.current?.key === quoteKey) {
          inFlightQuoteRef.current = null;
        }
      }
    })();

    return () => {
      if (inFlightQuoteRef.current?.key === quoteKey) {
        const activeQuote = inFlightQuoteRef.current;
        inFlightQuoteRef.current = null;
        activeQuote.controller.abort();
      }
    };
  }, [
    couponAppliedCode,
    customPaymentAmount,
    datesValid,
    debugWizardRequest,
    deliverySelected,
    deliveryZoneLabel,
    dropoffDate,
    dropoffTime,
    emailAddress,
    hasResolvedVehicle,
    hasSelectedVehicleId,
    hydrated,
    insuranceEnabled,
    insuranceSelected,
    paymentOption,
    pickupDate,
    pickupTime,
    resetQuoteRefresh,
    selectedVehicleId,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!couponAppliedCode || !selectedVehicleId) return () => {
      cancelled = true;
    };

    async function refreshCouponPreview() {
      try {
        const response = await fetch("/api/public/promos/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: couponAppliedCode,
            vehicleId: selectedVehicleId,
            startDate: pickupDate,
            endDate: dropoffDate,
            customerEmail: normalizeText(emailAddress),
            insuranceSelected: insuranceEnabled && insuranceSelected,
            insurancePlanId,
            deliverySelected,
            deliveryZoneLabel: deliveryZoneLabel || null,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as PromoValidationResponse;
        if (!response.ok || !data.ok) {
          if (cancelled) return;
          setCouponAppliedCode(null);
          setCouponDiscount(0);
          return;
        }
        const discount = Number(data.discountAmountCents ?? 0);
        if (cancelled) return;
        setCouponDiscount(Number.isFinite(discount) ? Math.max(0, discount) : 0);
      } catch {
        if (cancelled) return;
      }
    }

    void refreshCouponPreview();
    return () => {
      cancelled = true;
    };
  }, [
    couponAppliedCode,
    dropoffDate,
    emailAddress,
    insuranceEnabled,
    insurancePlanId,
    insurancePricePerDay,
    insuranceSelected,
    pickupDate,
    selectedVehicleId,
    deliverySelected,
    deliveryZoneLabel,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!hydrated) {
      return () => {
        cancelled = true;
      };
    }
    if (!pickupDate || !dropoffDate || !datesValid) {
      setVehicleOptions([]);
      setVehicleSelectionUnavailable(false);
      return () => {
        cancelled = true;
      };
    }

    async function loadVehicles() {
      setVehicleLoading(true);
      try {
        await loadAvailableVehicles({ reason: "effect" });
      } catch {
        if (cancelled) return;
      } finally {
        if (!cancelled) setVehicleLoading(false);
      }
    }

    void loadVehicles();

    return () => {
      cancelled = true;
    };
  }, [datesValid, dropoffDate, hydrated, loadAvailableVehicles, pickupDate]);

  const refreshAvailableVehiclesInBackground = useCallback(async () => {
    if (!hydrated || !datesValid) return;

    try {
      await loadAvailableVehicles({ reason: "background", force: true });
    } catch {
      const refreshState = reconcileVehicleRefreshState({
        previousVehicles: vehicleOptionsRef.current,
        nextVehicles: null,
        selectedVehicleId: selectedVehicleIdRef.current,
        failureMessage: VEHICLE_REFRESH_FAILURE_MESSAGE,
      });
      setVehicleRefreshWarning(refreshState.refreshWarning);
      setVehicleSelectionUnavailable(refreshState.vehicleSelectionUnavailable);
    }
  }, [datesValid, hydrated, loadAvailableVehicles]);

  useEffect(() => {
    if (!hydrated || !datesValid) return;
    if (step !== 2 && step !== 6) return;

    let active = true;
    const runRefresh = () => {
      if (!active) return;
      void refreshAvailableVehiclesInBackground();
    };
    const handleWindowFocus = () => {
      runRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      runRefresh();
    };

    const intervalId = window.setInterval(runRefresh, BACKGROUND_VEHICLE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [datesValid, hydrated, refreshAvailableVehiclesInBackground, step]);

  const setupSignatureCanvas = useCallback(
    (preserveDrawing: boolean) => {
      const canvas = signatureCanvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const cssWidth = Math.max(1, Math.floor(canvas.clientWidth));
      const cssHeight = Math.max(1, Math.floor(canvas.clientHeight));
      const pixelWidth = Math.max(1, Math.floor(cssWidth * ratio));
      const pixelHeight = Math.max(1, Math.floor(cssHeight * ratio));
      signaturePixelRatioRef.current = ratio;

      let previousImage: string | null = null;
      if (preserveDrawing && signatureDirtyRef.current && canvas.width > 0 && canvas.height > 0) {
        try {
          previousImage = canvas.toDataURL("image/png");
        } catch {
          previousImage = null;
        }
      }

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.5;
      const textColor =
        getComputedStyle(canvas).getPropertyValue("--ccr-text").trim() ||
        getComputedStyle(canvas).color ||
        "#0f172a";
      context.strokeStyle = textColor;

      if (previousImage) {
        const image = new Image();
        image.onload = () => {
          const redrawContext = canvas.getContext("2d");
          if (!redrawContext) return;
          redrawContext.setTransform(ratio, 0, 0, ratio, 0, 0);
          redrawContext.drawImage(image, 0, 0, cssWidth, cssHeight);
          redrawContext.lineCap = "round";
          redrawContext.lineJoin = "round";
          redrawContext.lineWidth = 2.5;
          redrawContext.strokeStyle = textColor;
        };
        image.src = previousImage;
      }
    },
    [],
  );

  const getSignaturePoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const drawWidth = canvas.width / Math.max(signaturePixelRatioRef.current, 1);
    const drawHeight = canvas.height / Math.max(signaturePixelRatioRef.current, 1);
    const x = ((event.clientX - rect.left) * drawWidth) / rect.width;
    const y = ((event.clientY - rect.top) * drawHeight) / rect.height;
    return { x, y };
  }, []);

  useEffect(() => {
    setupSignatureCanvas(false);

    const handleResize = () => setupSignatureCanvas(true);
    window.addEventListener("resize", handleResize);

    const themeTarget = document.documentElement;
    const observer = new MutationObserver(() => {
      setupSignatureCanvas(true);
    });
    observer.observe(themeTarget, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [setupSignatureCanvas]);

  function resetMessages() {
    setErrorMessage(null);
    setStatusMessage(null);
  }

  function updatePickupLocationValue(fieldKey: string, value: string) {
    setPickupLocationValues((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  }

  function updateDropoffLocationValue(fieldKey: string, value: string) {
    setDropoffLocationManuallyEdited(true);
    setDropoffLocationValues((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  }

  function handlePickupDateChange(nextPickupDate: string) {
    const previousPickupDate = pickupDate;
    const nextDropoffDate = addDaysToDateInput(nextPickupDate, 2);
    const previousDropoffDate = dropoffDate;
    setPickupDate(nextPickupDate);
    setDropoffDate(nextDropoffDate);
    setPickupLocationValues((current) =>
      syncLocationFieldDefaults({
        fields: pickupFieldSchema,
        currentValues: current,
        defaultSource: "pickup_date",
        previousValue: previousPickupDate,
        nextValue: nextPickupDate,
      }),
    );
    setDropoffLocationValues((current) =>
      syncLocationFieldDefaults({
        fields: dropoffFieldSchema,
        currentValues: current,
        defaultSource: "dropoff_date",
        previousValue: previousDropoffDate,
        nextValue: nextDropoffDate,
      }),
    );
  }

  function handlePickupTimeChange(nextPickupTime: string) {
    const previousPickupTime = pickupTime;
    setPickupTime(nextPickupTime);
    setPickupLocationValues((current) =>
      syncLocationFieldDefaults({
        fields: pickupFieldSchema,
        currentValues: current,
        defaultSource: "pickup_time",
        previousValue: previousPickupTime,
        nextValue: nextPickupTime,
      }),
    );
  }

  function handleDropoffDateChange(nextDropoffDate: string) {
    const previousDropoffDate = dropoffDate;
    setDropoffDate(nextDropoffDate);
    setDropoffLocationValues((current) =>
      syncLocationFieldDefaults({
        fields: dropoffFieldSchema,
        currentValues: current,
        defaultSource: "dropoff_date",
        previousValue: previousDropoffDate,
        nextValue: nextDropoffDate,
      }),
    );
  }

  function handleDropoffTimeChange(nextDropoffTime: string) {
    const previousDropoffTime = dropoffTime;
    setDropoffTime(nextDropoffTime);
    setDropoffLocationValues((current) =>
      syncLocationFieldDefaults({
        fields: dropoffFieldSchema,
        currentValues: current,
        defaultSource: "dropoff_time",
        previousValue: previousDropoffTime,
        nextValue: nextDropoffTime,
      }),
    );
  }

  function applyPickupLocationChange(nextTypeKey: string) {
    resetMessages();
    setPickupLocationId(nextTypeKey);
    setPickupLocationValues((current) =>
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(pickupOptions, nextTypeKey, "pickup"),
        "pickup",
        current,
        locationDefaultsContext,
      ),
    );
    if (!dropoffLocationManuallyEdited) {
      const nextDropoffTypeKey =
        dropoffOptions.some((location) => location.locationTypeKey === nextTypeKey)
          ? nextTypeKey
          : (dropoffOptions[0]?.locationTypeKey ?? nextTypeKey);
      setDropoffLocationId(nextDropoffTypeKey);
      setDropoffLocationValues(
        coerceBookingLocationFieldValues(
          getBookingLocationConfigByType(dropoffOptions, nextDropoffTypeKey, "dropoff"),
          "dropoff",
          pickupLocationValues.address ? { address: pickupLocationValues.address } : {},
          locationDefaultsContext,
        ),
      );
    }
  }

  function applyDropoffLocationChange(nextTypeKey: string) {
    resetMessages();
    setDropoffLocationId(nextTypeKey);
    setDropoffLocationManuallyEdited(true);
    setDropoffLocationValues((current) =>
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffOptions, nextTypeKey, "dropoff"),
        "dropoff",
        current,
        locationDefaultsContext,
      ),
    );
  }

  function handleMatchPickupLocation() {
    const nextDropoffTypeKey =
      pickupLocationConfig && dropoffOptions.some((location) => location.locationTypeKey === pickupLocationConfig.locationTypeKey)
        ? pickupLocationConfig.locationTypeKey
        : (dropoffOptions[0]?.locationTypeKey ?? pickupLocationConfig?.locationTypeKey ?? "OFFICE");
    setDropoffLocationManuallyEdited(false);
    setDropoffLocationId(nextDropoffTypeKey);
    setDropoffLocationValues(
      coerceBookingLocationFieldValues(
        getBookingLocationConfigByType(dropoffOptions, nextDropoffTypeKey, "dropoff"),
        "dropoff",
        pickupLocationValues.address ? { address: pickupLocationValues.address } : {},
        locationDefaultsContext,
      ),
    );
  }

  function clearSelectedVehicleSelection(
    options?: {
      message?: string;
      clearVehicleOptions?: boolean;
      clearCouponCode?: boolean;
    },
  ) {
    const shouldClearVehicleOptions = options?.clearVehicleOptions === true;
    const shouldClearCouponCode = options?.clearCouponCode === true;
    destroyVehicleLightbox();
    setSelectedVehicleId("");
    setVehicleSelectionUnavailable(false);
    setVehicleRefreshWarning(null);
    if (shouldClearVehicleOptions) setVehicleOptions([]);
    setProtectionChoice(null);
    setInsuranceEnabled(false);
    setInsurancePlanId(null);
    setInsurancePricePerDay(0);
    setInsuranceCoverage(155000);
    if (shouldClearCouponCode) setCouponCode("");
    setCouponAppliedCode(null);
    setCouponDiscount(0);
    setPricingState((previous) => ({
      status: "idle",
      current: null,
      lastGood: previous.lastGood,
      error: null,
    }));
    setPaymentOption("DEPOSIT");
    setCustomPaymentAmount("");
    setTurnstileToken(null);
    setTurnstileResetKey((value) => value + 1);
    if (options?.message) {
      setErrorMessage(null);
      setStatusMessage(options.message);
    }
  }

  const step1Complete =
    !dateWindowError &&
    Boolean(pickupLocationText) &&
    Boolean(dropoffLocationText) &&
    !validateBookingLocationSelection(pickupLocationConfig, "pickup", pickupLocationValues) &&
    !validateBookingLocationSelection(dropoffLocationConfig, "dropoff", dropoffLocationValues);
  const step2Complete = step1Complete && hasResolvedVehicle;
  const step3Complete = step2Complete;
  const step4Complete =
    step3Complete &&
    Boolean(normalizeText(firstName)) &&
    Boolean(normalizeText(lastName));
  const step5Complete = step4Complete && Boolean(signatureDataUrl) && acceptTerms;

  function getEarliestMissingStep(targetStep: WizardStep): WizardStep | null {
    if (targetStep >= 2 && !step1Complete) return 1;
    if (targetStep >= 3 && !step2Complete) return 2;
    if (targetStep >= 4 && !step3Complete) return 3;
    if (targetStep >= 5 && !step4Complete) return 4;
    if (targetStep >= 6 && !step5Complete) return 5;
    return null;
  }

  function jumpToStep(targetStep: WizardStep) {
    if (submitting) return;
    resetMessages();
    const scrollToWizardTop = () => {
      wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    if (targetStep < step) {
      setStep(targetStep);
      scrollToWizardTop();
      return;
    }

    if (targetStep > maxStepCompleted) {
      setErrorMessage(`Complete Step ${maxStepCompleted} first to unlock this step.`);
      return;
    }

    const missingStep = getEarliestMissingStep(targetStep);
    if (missingStep) {
      setStep(missingStep);
      setErrorMessage(`Please complete Step ${missingStep} before continuing.`);
      scrollToWizardTop();
      return;
    }

    setStep(targetStep);
    scrollToWizardTop();
  }

  function verifyStep(stepToValidate: WizardStep) {
    resetMessages();

    if (stepToValidate === 1) {
      if (dateWindowError) {
        setErrorMessage(dateWindowError);
        return false;
      }
      if (!pickupLocationText) {
        setErrorMessage("Select a pickup location.");
        return false;
      }
      if (!dropoffLocationText) {
        setErrorMessage("Select a dropoff location.");
        return false;
      }
      const pickupLocationError = validateBookingLocationSelection(
        pickupLocationConfig,
        "pickup",
        pickupLocationValues,
      );
      if (pickupLocationError) {
        setErrorMessage(pickupLocationError);
        return false;
      }
      const dropoffLocationError = validateBookingLocationSelection(
        dropoffLocationConfig,
        "dropoff",
        dropoffLocationValues,
      );
      if (dropoffLocationError) {
        setErrorMessage(dropoffLocationError);
        return false;
      }
    }

    if (stepToValidate === 2) {
      if (!hasSelectedVehicleId) {
        setErrorMessage("Select a vehicle to continue.");
        return false;
      }
      if (vehicleSelectionUnavailable || !selectedVehicle) {
        setErrorMessage("Selected vehicle is no longer available for these dates. Choose another.");
        return false;
      }
    }

    if (stepToValidate === 3) {
      if (protectionChoice === null) {
        setErrorMessage("Choose a protection option to continue.");
        return false;
      }
      if (protectionChoice === "STANDARD" && !insuranceEnabled) {
        setErrorMessage("Standard Protection is unavailable for this vehicle. Choose No Protection to continue.");
        return false;
      }
    }

    if (stepToValidate === 4) {
      if (!normalizeText(firstName) || !normalizeText(lastName)) {
        setErrorMessage("First name and last name are required.");
        return false;
      }
      if (!isEmail(normalizeText(emailAddress))) {
        setErrorMessage("A valid email address is required.");
        return false;
      }
      if (!isNonEmptyString(normalizeText(phoneNumber), 7)) {
        setErrorMessage("A valid phone number is required.");
        return false;
      }
    }

    if (stepToValidate === 5) {
      if (!signatureDataUrl) {
        setErrorMessage("Signature is required before confirmation.");
        return false;
      }
      if (!acceptTerms) {
        setErrorMessage("Please accept the privacy policy to continue.");
        return false;
      }
    }

    if (stepToValidate === 6) {
      if (!hasSelectedVehicleId) {
        setErrorMessage("Select a vehicle to continue.");
        return false;
      }
      if (vehicleSelectionUnavailable || !selectedVehicle) {
        setErrorMessage("Selected vehicle is no longer available for these dates. Choose another.");
        return false;
      }
      if (!pricingQuote) {
        setErrorMessage("Live pricing is still refreshing. Please wait before continuing.");
        return false;
      }
      if (!pricingQuoteReadyForCurrentSelection) {
        setErrorMessage("Live pricing is still refreshing for these dates. Please wait before continuing.");
        return false;
      }
      if (paymentOption === "CUSTOM" && !customPaymentIsValid) {
        setErrorMessage("Custom payment must be greater than 0 and not exceed amount due.");
        return false;
      }
    }

    return true;
  }

  async function revalidateSelectedVehicleAvailability(vehicleId: string) {
    try {
      const availableVehicles = await loadAvailableVehicles({
        reason: "revalidate",
        force: true,
      });
      const stillAvailable = availableVehicles.some((vehicle) => vehicle.id === vehicleId);
      if (!stillAvailable) {
        setVehicleSelectionUnavailable(true);
        setErrorMessage(
          "Selected vehicle is no longer available for these dates. Choose another.",
        );
        return false;
      }
      setVehicleSelectionUnavailable(false);
      return true;
    } catch {
      setErrorMessage("Unable to verify vehicle availability. Please try again.");
      return false;
    }
  }

  async function handleVehicleSelect(vehicleId: string) {
    resetMessages();
    setVehicleRefreshWarning(null);
    setVehicleLoading(true);
    const available = await revalidateSelectedVehicleAvailability(vehicleId);
    if (available) {
      setSelectedVehicleId(vehicleId);
      setProtectionChoice(null);
      setVehicleSelectionUnavailable(false);
      wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setStep(3);
      setMaxStepCompleted((current) => (current < 3 ? 3 : current));
      setStatusMessage("Vehicle selected and availability confirmed. Continue with your rental details.");
    }
    setVehicleLoading(false);
  }

  function handleDeselectVehicle() {
    resetMessages();
    wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStep(2);
    setMaxStepCompleted((current) => (current > 2 ? 2 : current));
    clearSelectedVehicleSelection({
      message: "Vehicle deselected. Choose a vehicle to continue.",
    });
  }

  async function moveToNextStep() {
    if (!verifyStep(step)) return;
    if (step === 2 && selectedVehicleId) {
      setVehicleLoading(true);
      const available = await revalidateSelectedVehicleAvailability(selectedVehicleId);
      setVehicleLoading(false);
      if (!available) return;
    }
    if (step >= 6) return;
    const nextStep = (step + 1) as WizardStep;
    wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStep(nextStep);
    setMaxStepCompleted((previous) => (nextStep > previous ? nextStep : previous));
  }

  function moveToPreviousStep() {
    resetMessages();
    wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStep((current) => (current > 1 ? ((current - 1) as WizardStep) : current));
  }

  function handleChangeDates() {
    resetMessages();
    wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStep(1);
    setMaxStepCompleted(1);
    clearSelectedVehicleSelection({
      clearVehicleOptions: true,
    });
    setStatusMessage("Update your dates and continue through vehicle selection.");
  }

  function handleChangeVehicle() {
    resetMessages();
    wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStep(2);
    setMaxStepCompleted((current) => (current < 2 ? 2 : current));
    setStatusMessage("Review your selected vehicle or choose another.");
  }

  function handleStartOver() {
    clearWizardDraft();
    preselectedVehicleIdRef.current = "";
    latestVehiclesRequestIdRef.current = 0;
    latestVehiclesKeyRef.current = "";
    lastVehiclesSuccessKeyRef.current = "";
    if (inFlightVehiclesRef.current) {
      inFlightVehiclesRef.current.controller.abort();
      inFlightVehiclesRef.current = null;
    }
    latestQuoteKeyRef.current = "";
    lastQuoteSuccessKeyRef.current = "";
    if (inFlightQuoteRef.current) {
      inFlightQuoteRef.current.controller.abort();
      inFlightQuoteRef.current = null;
    }
    setRequestedVehicleFromQuery("");
    setShowStartOverConfirm(false);
    setDraftWasRestored(false);
    wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    const defaultDateTime = defaultBookingDateTime({ minimumDays: minimumRentalGlobalDays });
    initialBookingDateTimeRef.current = defaultDateTime;
    initialPickupDateRef.current = defaultDateTime.pickupDate;
    initialDropoffDateRef.current = defaultDateTime.dropoffDate;
    initialPickupTimeRef.current = defaultDateTime.pickupTime;
    initialDropoffTimeRef.current = defaultDateTime.dropoffTime;
    const defaultPickupLocation =
      getBookingLocationConfigsForSide(locationOptions, "pickup")[0]?.locationTypeKey ?? "OFFICE";
    const defaultDropoffLocation =
      getBookingLocationConfigsForSide(locationOptions, "dropoff")[0]?.locationTypeKey ??
      defaultPickupLocation;

    setStep(1);
    setMaxStepCompleted(1);
    setPickupDate(defaultDateTime.pickupDate);
    setPickupTime(defaultDateTime.pickupTime);
    setDropoffDate(defaultDateTime.dropoffDate);
    setDropoffTime(defaultDateTime.dropoffTime);
    setPickupLocationId(defaultPickupLocation);
    setDropoffLocationId(defaultDropoffLocation);
    setPickupLocationValues(
      buildBookingLocationSelectionPayload({
        configs: locationOptions,
        pickupTypeKey: defaultPickupLocation,
        dropoffTypeKey: defaultDropoffLocation,
        pickupValues: {},
        dropoffValues: {},
        context: {
          pickupDate: defaultDateTime.pickupDate,
          pickupTime: defaultDateTime.pickupTime,
          dropoffDate: defaultDateTime.dropoffDate,
          dropoffTime: defaultDateTime.dropoffTime,
        },
      }).pickupValues,
    );
    setDropoffLocationValues(
      buildBookingLocationSelectionPayload({
        configs: locationOptions,
        pickupTypeKey: defaultPickupLocation,
        dropoffTypeKey: defaultDropoffLocation,
        pickupValues: {},
        dropoffValues: {},
        context: {
          pickupDate: defaultDateTime.pickupDate,
          pickupTime: defaultDateTime.pickupTime,
          dropoffDate: defaultDateTime.dropoffDate,
          dropoffTime: defaultDateTime.dropoffTime,
        },
      }).dropoffValues,
    );
    setDropoffLocationManuallyEdited(false);

    setSelectedVehicleId("");
    setVehicleSelectionUnavailable(false);
    setVehicleOptions([]);
    setProtectionChoice(null);
    setInsuranceEnabled(false);
    setInsurancePlanId(null);
    setInsurancePricePerDay(0);
    setInsuranceCoverage(155000);
    setCouponCode("");
    setCouponAppliedCode(null);
    setCouponDiscount(0);
    setPricingState(createPricingLifecycleState<PricingQuoteSummary>());

    setFirstName("");
    setLastName("");
    setEmailAddress("");
    setPhoneNumber("");
    setStreet("");
    setStreet2("");
    setCity("");
    setParish("");
    setCountry("Jamaica");
    setBirthday("");
    setDriversLicenseNumber("");
    setDriversLicenseExpirationDate("");
    setDriversLicenseImageUrls([]);
    setCustomerId(null);
    setAcceptTerms(false);
    setSignatureDataUrl("");
    signatureDirtyRef.current = false;
    signatureDrawingRef.current = false;
    const signatureCanvas = signatureCanvasRef.current;
    if (signatureCanvas) {
      const context = signatureCanvas.getContext("2d");
      if (context) {
        context.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
      }
    }

    setPaymentOption("DEPOSIT");
    setCustomPaymentAmount("");
    setTurnstileToken(null);
    setTurnstileResetKey((value) => value + 1);
    setReturningTurnstileToken(null);
    setReturningTurnstileResetKey((value) => value + 1);
    setShowReturningCustomerModal(false);
    setReturningStage("lookup");
    setReturningError(null);
    setReturningChallengeToken("");
    setReturningOtpCode("");
    setReturningLastName("");
    setReturningBusy(false);
    setSubmitting(false);
    setErrorMessage(null);
    setStatusMessage("Booking draft cleared. Start again with dates and vehicle selection.");
    router.replace("/book");
  }

  async function uploadDriversLicenseFiles(files: File[]) {
    if (files.length === 0) return;
    setErrorMessage(null);
    setDriversLicenseUploading(true);
    try {
      const availableSlots = Math.max(
        0,
        MAX_DRIVERS_LICENSE_IMAGES - driversLicenseImageUrls.length,
      );
      if (availableSlots === 0) {
        throw new Error(
          `You can upload up to ${MAX_DRIVERS_LICENSE_IMAGES} driver's license images.`,
        );
      }
      const selectedFiles = files.slice(0, availableSlots);
      const dataUrls = await Promise.all(
        selectedFiles.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error("Unable to read driver's license image."));
              reader.onload = () => {
                if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
                  resolve(reader.result);
                  return;
                }
                reject(new Error("Driver's license image must be a valid image file."));
              };
              reader.readAsDataURL(file);
            }),
        ),
      );
      setDriversLicenseImageUrls((current) => [...current, ...dataUrls]);
      if (files.length > availableSlots) {
        setStatusMessage(
          `Only ${MAX_DRIVERS_LICENSE_IMAGES} driver's license images can be attached.`,
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to upload driver's license images.",
      );
    } finally {
      setDriversLicenseUploading(false);
    }
  }

  async function onDriversLicenseFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadDriversLicenseFiles(files);
  }

  async function applyCoupon() {
    if (couponBusy) return;
    if (!selectedVehicle) {
      setErrorMessage("Select a vehicle before applying a coupon.");
      return;
    }
    if (!normalizeText(couponCode)) {
      setErrorMessage("Enter a coupon code.");
      return;
    }

    setCouponBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/public/promos/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponCode,
          vehicleId: selectedVehicle.id,
          startDate: pickupDate,
          endDate: dropoffDate,
          customerEmail: normalizeText(emailAddress),
          insuranceSelected: insuranceEnabled && insuranceSelected,
          insurancePlanId,
          deliverySelected,
          deliveryZoneLabel: deliveryZoneLabel || null,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as PromoValidationResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Coupon could not be applied.");
      }

      const discount = Number(data.discountAmountCents ?? 0);
      setCouponAppliedCode((data.code ?? couponCode).trim().toUpperCase());
      setCouponDiscount(Number.isFinite(discount) ? Math.max(0, discount) : 0);
      if (data.isEstimate) {
        setStatusMessage(
          `Coupon ${(data.code ?? couponCode).trim().toUpperCase()} applied (estimate). Final total is rechecked at confirmation.`,
        );
      } else {
        setStatusMessage(`Coupon ${(data.code ?? couponCode).trim().toUpperCase()} applied.`);
      }
    } catch (error) {
      setCouponAppliedCode(null);
      setCouponDiscount(0);
      setErrorMessage(error instanceof Error ? error.message : "Coupon could not be applied.");
    } finally {
      setCouponBusy(false);
    }
  }

  function clearCoupon() {
    setCouponAppliedCode(null);
    setCouponDiscount(0);
    setCouponCode("");
    setStatusMessage("Coupon removed.");
    setErrorMessage(null);
  }

  function buildAgreementSignatureDataUrl(canvas: HTMLCanvasElement): string {
    const fallback = canvas.toDataURL("image/png");
    const normalizedCanvas = document.createElement("canvas");
    normalizedCanvas.width = canvas.width;
    normalizedCanvas.height = canvas.height;
    const context = normalizedCanvas.getContext("2d");
    if (!context) return fallback;
    context.drawImage(canvas, 0, 0, normalizedCanvas.width, normalizedCanvas.height);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, normalizedCanvas.width, normalizedCanvas.height);
    return normalizedCanvas.toDataURL("image/png");
  }

  function beginSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    setupSignatureCanvas(true);
    const point = getSignaturePoint(event);
    if (!point) return;
    canvas.setPointerCapture(event.pointerId);
    signatureDrawingRef.current = true;
    signatureDirtyRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    if (!signatureDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = getSignaturePoint(event);
    if (!point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function endSignature(event?: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (canvas && event && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!signatureDrawingRef.current) return;
    signatureDrawingRef.current = false;
    const context = canvas?.getContext("2d");
    context?.closePath();
    if (!canvas || !signatureDirtyRef.current) return;
    setSignatureDataUrl(buildAgreementSignatureDataUrl(canvas));
  }

  function clearSignature() {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    signatureDrawingRef.current = false;
    signatureDirtyRef.current = false;
    setSignatureDataUrl("");
  }

  async function startReturningCustomerLookup() {
    if (returningBusy) return;
    if (!returningTurnstileToken) {
      setReturningError("Please complete the security check before continuing.");
      return;
    }
    setReturningBusy(true);
    setReturningError(null);

    try {
      const response = await fetch("/api/public/returning-customer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: returningDlInput,
          sessionKey: returningSessionKey,
          turnstileToken: returningTurnstileToken,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ReturningStartResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "We couldn't verify your details.");
      }

      setReturningChallengeToken(data.challengeToken ?? "");
      setReturningStage("verify");
      setReturningTurnstileToken(null);
      setReturningTurnstileResetKey((value) => value + 1);
    } catch (error) {
      setReturningError(
        error instanceof Error && error.message
          ? error.message
          : "Verification failed. Please complete the security check and retry.",
      );
      setReturningTurnstileToken(null);
      setReturningTurnstileResetKey((value) => value + 1);
    } finally {
      setReturningBusy(false);
    }
  }

  async function verifyReturningCustomer() {
    if (returningBusy) return;
    if (!returningTurnstileToken) {
      setReturningError("Please complete the security check before verifying.");
      return;
    }
    setReturningBusy(true);
    setReturningError(null);

    try {
      const response = await fetch("/api/public/returning-customer/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: returningDlInput,
          challengeToken: returningChallengeToken,
          otpCode: returningOtpCode,
          lastName: returningLastName,
          sessionKey: returningSessionKey,
          turnstileToken: returningTurnstileToken,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ReturningVerifyResponse;
      if (!response.ok || !data.ok || !data.customer) {
        throw new Error(data.error || "We couldn't verify your details.");
      }

      setCustomerId(data.customer.customerId ?? null);
      setFirstName((current) => setIfPresent(current, data.customer?.firstName));
      setLastName((current) => setIfPresent(current, data.customer?.lastName));
      setEmailAddress((current) => setIfPresent(current, data.customer?.emailAddress));
      setPhoneNumber((current) => setIfPresent(current, data.customer?.phoneNumber));
      setStreet((current) => setIfPresent(current, data.customer?.street));
      setStreet2((current) => setIfPresent(current, data.customer?.street2));
      setCity((current) => setIfPresent(current, data.customer?.city));
      setParish((current) => setIfPresent(current, data.customer?.parish));
      setCountry((current) => setIfPresent(current, data.customer?.country));
      setBirthday((current) => setIfPresent(current, data.customer?.birthday));
      setDriversLicenseNumber((current) =>
        setIfPresent(current, data.customer?.driversLicenseNumber),
      );
      setDriversLicenseExpirationDate((current) =>
        setIfPresent(current, data.customer?.driversLicenseExpirationDate),
      );

      setShowReturningCustomerModal(false);
      setStatusMessage("Returning customer details loaded. Please verify and continue.");
      setReturningTurnstileToken(null);
      setReturningTurnstileResetKey((value) => value + 1);
    } catch (error) {
      setReturningError(
        error instanceof Error && error.message
          ? error.message
          : "Verification failed. Please complete the security check and retry.",
      );
      setReturningTurnstileToken(null);
      setReturningTurnstileResetKey((value) => value + 1);
    } finally {
      setReturningBusy(false);
    }
  }

  function buildCheckoutRoute(
    bookingId: string,
    mode: "DEPOSIT" | "FULL" | "CUSTOM",
    customAmountCents?: number,
  ) {
    const query = new URLSearchParams({
      bookingId,
      paymentOption: mode,
    });
    if (mode === "CUSTOM") {
      query.set("customAmountCents", String(Math.max(1, Math.round(customAmountCents ?? 0))));
    }
    return `/book/checkout?${query.toString()}`;
  }

  async function submitBooking() {
    if (submitting) return;
    if (!verifyStep(6)) return;
    if (!turnstileToken) {
      setErrorMessage("Please complete the security check before confirming your reservation.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const fullName = `${normalizeText(firstName)} ${normalizeText(lastName)}`.trim();
      const submissionKey = getBookingSubmissionKey();
      const normalizedCustomAmount =
        paymentOption === "CUSTOM" ? Math.max(1, Math.round(customPaymentNumber)) : null;
      const locationSelection = buildBookingLocationSelectionPayload({
        configs: locationOptions,
        pickupTypeKey: pickupLocationId,
        dropoffTypeKey: dropoffLocationId,
        pickupLocationId: pickupLocationConfig?.id ?? null,
        dropoffLocationId: dropoffLocationConfig?.id ?? null,
        pickupValues: pickupLocationValues,
        dropoffValues: dropoffLocationValues,
        context: locationDefaultsContext,
      });

      const bookingResponse = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: selectedVehicleId,
          submissionKey,
          turnstileToken,
          customerId,
          fullName,
          email: normalizeText(emailAddress),
          phone: normalizeText(phoneNumber),
          startDate: pickupDate,
          endDate: dropoffDate,
          pickupLocation: locationSelection.pickupLocationTextSnapshot,
          dropoffLocation: locationSelection.dropoffLocationTextSnapshot,
          pickupLocationType: pickupLocationId,
          dropoffLocationType: dropoffLocationId,
          pickupLocationId: locationSelection.pickupConfig?.id ?? null,
          dropoffLocationId: locationSelection.dropoffConfig?.id ?? null,
          pickupTime,
          dropoffTime,
          pickupLocationTextSnapshot: locationSelection.pickupLocationTextSnapshot,
          dropoffLocationTextSnapshot: locationSelection.dropoffLocationTextSnapshot,
          bookingLocationDetails: locationSelection.details,
          insuranceSelected: insuranceEnabled && insuranceSelected,
          insurancePlanId,
          couponCode: couponAppliedCode,
          deliverySelected,
          deliveryZoneLabel: deliveryZoneLabel || null,
          insurancePricePerDayCents:
            pricingQuote?.insurancePricePerDay ?? insurancePricePerDay,
          insuranceTotalCents: insuranceTotal,
          paymentOption,
          customPaymentAmountCents: normalizedCustomAmount,
          legalIdType: "DRIVERS_LICENSE",
          legalIdNumber: normalizeText(driversLicenseNumber),
          legalIdImageUploadToken: driversLicenseImageUrls[0] ?? "",
          driversLicenseDataUrl: driversLicenseImageUrls[0] ?? "",
          driversLicenseDataUrls: driversLicenseImageUrls,
          driversLicenseNumber: normalizeText(driversLicenseNumber),
          driversLicenseExpirationDate: normalizeText(driversLicenseExpirationDate) || null,
          signatureDataUrl,
          customerProfile: {
            firstName: normalizeText(firstName),
            lastName: normalizeText(lastName),
            emailAddress: normalizeText(emailAddress) || null,
            phoneNumber: normalizeText(phoneNumber) || null,
            street: normalizeText(street) || null,
            street2: normalizeText(street2) || null,
            city: normalizeText(city) || null,
            parish: normalizeText(parish) || null,
            country: normalizeText(country) || null,
            birthday: normalizeText(birthday) || null,
          },
        }),
      });

      const bookingData = (await bookingResponse.json().catch(() => ({}))) as BookingCreateResponse;
      if (!bookingResponse.ok || !bookingData.bookingId) {
        setTurnstileToken(null);
        setTurnstileResetKey((value) => value + 1);
        throw new Error(bookingData.error ?? "Unable to create booking.");
      }

      const bookingId = bookingData.bookingId;
      bookingSubmissionKeyRef.current = "";
      if (bookingData.bookingAccessToken) {
        document.cookie = `ccr_booking_access_${bookingId}=${encodeURIComponent(
          bookingData.bookingAccessToken,
        )}; Path=/; Max-Age=2592000; SameSite=Lax`;
      }
      if (paymentOption === "NONE") {
        const csrfToken = await ensureCsrfToken();
        if (!csrfToken) {
          throw new Error("Unable to verify your session. Refresh the page and try again.");
        }
        const response = await fetch(`/api/public/bookings/${bookingId}/pay-on-pickup`, {
          method: "POST",
          headers: { "x-csrf-token": csrfToken ?? "" },
        });
        if (!response.ok) {
          setStatusMessage(
            "Booking created. Pay on pickup was not auto-selected; you can select it on the booking page.",
          );
        }
        clearWizardDraft();
        router.push(`/bookings/${bookingId}`);
        return;
      }

      if (paymentOption === "FULL") {
        router.push(buildCheckoutRoute(bookingId, "FULL"));
        return;
      }

      if (paymentOption === "DEPOSIT") {
        router.push(buildCheckoutRoute(bookingId, "DEPOSIT"));
        return;
      }

      if (!normalizedCustomAmount) {
        throw new Error("Custom payment amount is required.");
      }
      router.push(buildCheckoutRoute(bookingId, "CUSTOM", normalizedCustomAmount));
    } catch (error) {
      setTurnstileToken(null);
      setTurnstileResetKey((value) => value + 1);
      setErrorMessage(error instanceof Error ? error.message : "Unable to submit booking.");
    } finally {
      setSubmitting(false);
    }
  }

  const paymentWarning =
    paymentOption === "NONE"
      ? "Please note vehicle availability is not guaranteed without payment. To guarantee availability a deposit is required."
      : paymentOption === "CUSTOM" && customPaymentIsValid && customPaymentNumber < depositRequired
        ? "Custom payment is below deposit. This may not guarantee the vehicle."
        : null;
  const unavailableVehicleWarning = hasSelectedVehicleId && vehicleSelectionUnavailable
    ? "Selected vehicle is no longer available for these dates. Choose another."
    : null;
  const step6VehicleWarning = !hasSelectedVehicleId
    ? "Select a vehicle to continue."
    : unavailableVehicleWarning
      ? unavailableVehicleWarning
      : !hasResolvedVehicle
        ? "Refreshing selected vehicle..."
      : null;
  const step6PricingWarning =
    hasSelectedVehicleId && (!pricingQuote || !pricingQuoteReadyForCurrentSelection)
      ? pricingQuoteLoading || pricingQuoteUpdating || pricingState.status === "loading"
        ? "Refreshing live pricing…"
        : pricingState.status === "error"
          ? "Live pricing could not be loaded. Return to Step 2 and reselect your vehicle."
          : pricingQuote && !pricingQuoteReadyForCurrentSelection
            ? "Live pricing is refreshing for these dates."
          : null
      : null;
  const step6SecurityHint = driversLicenseUploading
    ? "Driver's license image is still processing. Wait for it to finish before continuing."
    : !turnstileToken
      ? "Complete the security check to enable checkout."
      : null;
  const continueToPaymentDisabled =
    submitting ||
    driversLicenseUploading ||
    !turnstileToken ||
    !hasResolvedVehicle ||
    vehicleSelectionUnavailable ||
    !pricingQuote ||
    !pricingQuoteReadyForCurrentSelection ||
    (paymentOption === "CUSTOM" && !customPaymentIsValid);
  const statusIsDraftRestoreNotice =
    draftWasRestored &&
    typeof statusMessage === "string" &&
    statusMessage.startsWith("Draft restored.");
  const summaryVehicleLabel = selectedVehicle
    ? displayVehicleName(selectedVehicle)
    : hasSelectedVehicleId
      ? vehicleSelectionUnavailable
        ? "Unavailable for selected dates"
        : "Refreshing selection..."
      : "Not selected";
  const hideFallbackTotals = hasSelectedVehicleId && !pricingQuote;
  const bookingSupportHighlights = (
    <div className="grid gap-3 sm:grid-cols-3">
      <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
          Simple pricing
        </p>
        <p className="mt-3 text-sm leading-6 text-white/76">
          Live totals stay updated as your dates, protections, and payment choices change.
        </p>
      </article>
      <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
          Local support
        </p>
        <p className="mt-3 text-sm leading-6 text-white/76">
          {`Questions before checkout? Reach the Kingston team at ${siteContent.phones[0]?.label}.`}
        </p>
      </article>
      <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
          Secure checkout
        </p>
        <p className="mt-3 text-sm leading-6 text-white/76">
          {`Reservation details are reviewed in six steps before Step 7 launches ${hostedPaymentProvider}.`}
        </p>
      </article>
    </div>
  );
  const bookingIntro = (
    <>
      <section className="relative overflow-hidden border-b border-[var(--ccr-border)] bg-[var(--ccr-primary)] text-white sm:hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(255,207,109,0.18),transparent_38%)]" />
        <Container className="relative py-6">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--ccr-accent)]">
              Book
            </p>
            <h1 className="mt-3 text-[1.95rem] font-semibold leading-[1.08] tracking-tight text-white">
              Start your reservation.
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/78">
              Choose your dates and continue through the guided booking steps below.
            </p>
          </div>
        </Container>
      </section>

      <div className="hidden sm:block">
        <PublicPageIntro
          eyebrow="Book"
          title="Reserve your Curated vehicle with guided steps and clear pricing."
          description="Choose your dates, review the right vehicle, confirm your details, and continue to secure checkout when you are ready."
          primaryAction={{ href: "/fleet", label: "Browse Fleet" }}
          secondaryAction={{ href: "/contact", label: "Need Help?" }}
        >
          {bookingSupportHighlights}
        </PublicPageIntro>
      </div>
    </>
  );

  if (!hydrated) {
    return (
      <div className="bg-[var(--ccr-bg)] pb-12 sm:pb-16" data-testid="booking-draft-loading">
        {bookingIntro}
        <Container className="-mt-6 sm:-mt-8 md:-mt-12">
          <div className="rounded-[1.7rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/95 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.12)] backdrop-blur-sm sm:rounded-[2rem] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
              Restoring draft
            </p>
            <h1 className="mt-3 text-[1.95rem] font-semibold tracking-tight text-[var(--ccr-text)] sm:text-3xl">
              Loading your booking
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ccr-muted)]">
              We&apos;re restoring your previous selections and pricing details so you can continue where you left off.
            </p>
          </div>
        </Container>
      </div>
    );
  }

  return (
    <div className="bg-[var(--ccr-bg)] pb-12 sm:pb-16" data-testid="booking-wizard-hydrated">
      {bookingIntro}
      <div ref={wizardContainerRef} className="scroll-mt-24 sm:scroll-mt-28">
        <Container className="-mt-6 sm:-mt-8 md:-mt-12">
          <div className="min-w-0 overflow-hidden rounded-[1.7rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/96 shadow-[0_32px_110px_rgba(15,23,42,0.14)] backdrop-blur-sm sm:rounded-[2rem]">
          <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/75 px-3.5 py-3 sm:px-4 sm:py-6 md:px-8">
            <div className="sm:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                Start booking
              </p>
              <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                Step {step} of 6. Begin with your dates below.
              </p>
            </div>

            <div className="hidden min-w-0 flex-col gap-6 sm:flex xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0 max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                  Guided reservation
                </p>
                <h2 className="mt-3 break-words text-[1.8rem] font-semibold tracking-tight text-[var(--ccr-text)] sm:text-3xl md:text-4xl">
                  Complete six steps before secure checkout.
                </h2>
                <p className="mt-4 break-words text-base leading-7 text-[var(--ccr-muted)]">
                  Keep your selections accurate as dates, availability, pricing, and payment details
                  update in real time.
                </p>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-3 xl:w-[34rem]">
                <article className="min-w-0 rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                    Pickup window
                  </p>
                  <p className="mt-3 break-words text-sm font-semibold text-[var(--ccr-text)]">
                    {pickupDate} at {pickupTime}
                  </p>
                </article>
                <article className="min-w-0 rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                    Vehicle status
                  </p>
                  <p className="mt-3 break-words text-sm font-semibold text-[var(--ccr-text)]">
                    {summaryVehicleLabel}
                  </p>
                </article>
                <article className="min-w-0 rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                    Reserve now
                  </p>
                  <p className="mt-3 break-words text-sm font-semibold text-[var(--ccr-text)]">
                    {hideFallbackTotals ? "Pricing updating" : formatJmd(depositRequired)}
                  </p>
                </article>
              </div>
            </div>

            <div className="-mx-1 mt-4 min-w-0 overflow-x-auto pb-1 sm:mx-0 sm:mt-6 sm:overflow-visible">
              <ol className="flex min-w-max gap-2 px-1 sm:grid sm:min-w-0 sm:grid-cols-3 sm:px-0 sm:gap-3 lg:grid-cols-7">
                {STEPS.map((item) => {
                  const isActive = item.step === step;
                  const isDone = item.step < step;
                  const isUnlocked = item.step <= maxStepCompleted;
                  return (
                    <li key={item.step} className="min-w-[6.1rem] shrink-0 sm:min-w-0">
                      <button
                        type="button"
                        onClick={() => jumpToStep(item.step)}
                        disabled={!isUnlocked || submitting}
                        className={cn(
                          "w-full rounded-[1.15rem] border px-2 py-2 text-left transition disabled:opacity-55 sm:rounded-[1.35rem] sm:px-4 sm:py-3",
                          isActive
                            ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 text-[var(--ccr-text)] shadow-sm shadow-[var(--ccr-accent)]/10"
                            : isDone
                              ? "border-[var(--ccr-accent)]/40 bg-[var(--ccr-accent)]/5 text-[var(--ccr-text)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 text-[var(--ccr-muted)]",
                        )}
                        data-testid={`booking-step-tab-${item.step}`}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                          Step {item.step}
                        </p>
                        <p className="mt-1.5 text-[13px] font-semibold sm:mt-2 sm:text-sm">{item.title}</p>
                      </button>
                    </li>
                  );
                })}
                <li className="min-w-[6.1rem] shrink-0 sm:min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      resetMessages();
                      wizardContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      setStep(6);
                      setStatusMessage("Step 7 launches when you continue from Payments.");
                    }}
                    disabled={maxStepCompleted < 6 || submitting}
                    className={cn(
                      "w-full rounded-[1.15rem] border px-2 py-2 text-left transition disabled:opacity-55 sm:rounded-[1.35rem] sm:px-4 sm:py-3",
                      maxStepCompleted >= 6
                        ? "border-[var(--ccr-accent)]/40 bg-[var(--ccr-accent)]/5 text-[var(--ccr-text)]"
                        : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 text-[var(--ccr-muted)]",
                    )}
                    data-testid="booking-step-tab-7"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                      Step {checkoutStep.step}
                    </p>
                    <p className="mt-1.5 text-[13px] font-semibold sm:mt-2 sm:text-sm">{checkoutStep.title}</p>
                  </button>
                </li>
              </ol>
            </div>
          </div>

          <div className="grid min-w-0 items-start gap-5 bg-[linear-gradient(180deg,rgba(148,163,184,0.06),transparent)] px-3.5 py-4 sm:px-4 sm:py-5 md:px-6 md:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <div className="min-w-0 rounded-[1.5rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/96 px-3.5 py-4 shadow-[0_18px_56px_rgba(15,23,42,0.08)] sm:rounded-[1.75rem] sm:px-4 sm:py-5 md:px-6 md:py-7">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ccr-border)] pb-4 sm:mb-6 sm:pb-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                    Step {step} of 6
                  </p>
                  <p className="mt-2 hidden break-words text-sm text-[var(--ccr-muted)] sm:block">
                    Review each section carefully. Live availability and pricing stay connected while you move through the wizard.
                  </p>
                </div>
                <div className="hidden w-full rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ccr-muted)] min-[430px]:w-auto sm:block">
                  Secure booking flow
                </div>
              </div>
              {step === 1 ? (
                <section className="min-w-0" data-testid="booking-step-dates">
                  <h2 className="break-words text-xl font-bold text-[var(--ccr-text)]">Date & Time</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Select pickup and dropoff date/time plus location options.
                  </p>
                  {locationsLoading ? (
                    <p className="mt-2 text-xs text-[var(--ccr-muted)]">Refreshing available locations…</p>
                  ) : null}

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pickup Date</span>
                      <input
                        type="date"
                        value={pickupDate}
                        min={dateInputForOffset(0)}
                        onChange={(event) => handlePickupDateChange(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pickup Time</span>
                      <input
                        type="time"
                        value={pickupTime}
                        onChange={(event) => handlePickupTimeChange(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Date</span>
                      <input
                        type="date"
                        value={dropoffDate}
                        min={pickupDate}
                        onChange={(event) => handleDropoffDateChange(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Time</span>
                      <input
                        type="time"
                        value={dropoffTime}
                        onChange={(event) => handleDropoffTimeChange(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                  </div>
                  {dateWindowError ? (
                    <p className="mt-3 rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {dateWindowError}
                    </p>
                  ) : null}

                  <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pickup Location</span>
                      <select
                        value={pickupLocationId}
                        onChange={(event) => applyPickupLocationChange(event.target.value)}
                        disabled={locationsLoading}
                        className={bookingSoftFieldClassName}
                      >
                        {pickupOptions.map((location) => (
                          <option key={location.locationTypeKey} value={location.locationTypeKey}>
                            {location.pickupLabel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="min-w-0">
                      <div className="flex flex-col items-start gap-2 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
                        <span className="text-sm font-semibold text-[var(--ccr-muted)]">
                          Dropoff Location
                        </span>
                        {dropoffLocationManuallyEdited ? (
                          <button
                            type="button"
                            onClick={handleMatchPickupLocation}
                            className={cn("w-full justify-center min-[430px]:w-auto", bookingOutlineButtonClassName)}
                          >
                            Match pickup
                          </button>
                        ) : null}
                      </div>
                      <select
                        value={dropoffLocationId}
                        onChange={(event) => applyDropoffLocationChange(event.target.value)}
                        disabled={locationsLoading}
                        className={bookingSoftFieldClassName}
                      >
                        {dropoffOptions.map((location) => (
                          <option key={location.locationTypeKey} value={location.locationTypeKey}>
                            {location.dropoffLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
                    <div className="min-w-0 space-y-4">
                      {pickupFieldSchema.map((field) => (
                        <label
                          key={`pickup-${field.appliesTo}-${field.key}-${field.label}`}
                          className="block min-w-0"
                        >
                          <span className="text-sm font-semibold text-[var(--ccr-muted)]">
                            {field.label}
                          </span>
                          <input
                            type={field.inputType}
                            value={pickupLocationValues[field.key] ?? ""}
                            onChange={(event) =>
                              updatePickupLocationValue(field.key, event.target.value)
                            }
                            placeholder={field.inputType === "text" ? "Enter a value" : undefined}
                            className={`${bookingSoftFieldClassName} ${
                              field.inputType === "date"
                                ? "promo-date-time-input date-icon-edge"
                                : field.inputType === "time"
                                  ? "promo-date-time-input"
                                  : ""
                            }`}
                          />
                        </label>
                      ))}
                    </div>

                    <div className="min-w-0 space-y-4">
                      {dropoffFieldSchema.map((field) => (
                        <label
                          key={`dropoff-${field.appliesTo}-${field.key}-${field.label}`}
                          className="block min-w-0"
                        >
                          <span className="text-sm font-semibold text-[var(--ccr-muted)]">
                            {field.label}
                          </span>
                          <input
                            type={field.inputType}
                            value={dropoffLocationValues[field.key] ?? ""}
                            onChange={(event) =>
                              updateDropoffLocationValue(field.key, event.target.value)
                            }
                            placeholder={field.inputType === "text" ? "Enter a value" : undefined}
                            className={`${bookingSoftFieldClassName} ${
                              field.inputType === "date"
                                ? "promo-date-time-input date-icon-edge"
                                : field.inputType === "time"
                                  ? "promo-date-time-input"
                                  : ""
                            }`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {step === 2 ? (
                <section className="min-w-0" data-testid="booking-step-vehicles">
                  <h2 className="break-words text-xl font-bold text-[var(--ccr-text)]">Available Vehicles</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Choose a vehicle for your dates. Details are pulled from your admin fleet setup.
                  </p>
                  {unavailableVehicleWarning ? (
                    <div className="mt-4 rounded-xl border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] px-4 py-3 text-sm text-[var(--ccr-clerk-danger-text)]">
                      {unavailableVehicleWarning}
                    </div>
                  ) : null}
                  {vehicleRefreshWarning ? (
                    <div
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                      data-testid="booking-step2-refresh-warning"
                    >
                      {vehicleRefreshWarning}
                    </div>
                  ) : null}
                  {hasSelectedVehicleId ? (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={handleDeselectVehicle}
                        className="rounded-xl border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-clerk-danger-text)]"
                        data-testid="booking-step2-deselect-vehicle"
                      >
                        Deselect vehicle
                      </button>
                    </div>
                  ) : null}

                  {vehicleLoading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Checking availability…</p> : null}

                  <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">
                    {vehicleOptions.map((vehicle) => {
                      const selected = vehicle.id === selectedVehicleId;
                      return (
                        <PublicVehicleOptionCard
                          key={vehicle.id}
                          vehicle={vehicle}
                          selected={selected}
                          loading={vehicleLoading}
                          rentalDays={rentalDays}
                          onSelect={() => void handleVehicleSelect(vehicle.id)}
                          onDeselect={handleDeselectVehicle}
                          onImageClick={() => openVehicleLightbox(vehicle.id)}
                          formatMoney={formatJmd}
                        />
                      );
                    })}
                    {!vehicleLoading && vehicleOptions.length === 0 ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:col-span-2">
                        No vehicles are available for the selected pickup/dropoff range.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {step === 3 ? (
                <section className="min-w-0">
                  <div className="mt-4 min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
                    <p className="text-sm font-semibold text-[var(--ccr-text)]">Coupon Code</p>
                    <div className="mt-2 flex min-w-0 flex-col gap-2 min-[430px]:flex-row min-[430px]:items-start">
                      <input
                        value={couponCode}
                        onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                        placeholder="Enter coupon code"
                        className="min-w-0 w-full flex-1 rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm min-[430px]:min-w-[220px]"
                      />
                      <button
                        type="button"
                        onClick={applyCoupon}
                        disabled={couponBusy}
                        className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-[var(--ccr-on-primary)] disabled:opacity-60 min-[430px]:w-auto"
                      >
                        {couponBusy ? "Applying..." : "Apply"}
                      </button>
                      {couponAppliedCode ? (
                        <button
                          type="button"
                          onClick={clearCoupon}
                          className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] min-[430px]:w-auto"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {couponAppliedCode ? (
                      <p className="mt-2 text-sm text-emerald-700">
                        {couponAppliedCode} applied.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-6 border-t border-[var(--ccr-border)]" />

                  <div className="mt-6">
                    <h2 className="break-words text-xl font-bold text-[var(--ccr-text)]">Insurance Coverage</h2>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                      Choose your insurance preference. This selection is required.
                    </p>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setProtectionChoice("NONE");
                        }}
                        className={`flex h-full min-w-0 flex-col rounded-2xl border p-5 text-left transition ${
                          protectionChoice === "NONE"
                            ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 shadow-[0_0_0_1px_rgba(245,199,88,0.2)]"
                            : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] hover:border-[var(--ccr-accent)]/40"
                        }`}
                      >
                        <div className="min-h-[11.5rem]">
                          <p className="text-lg font-semibold text-[var(--ccr-text)]">No Protection</p>
                          <p className="mt-2 text-3xl font-bold text-[var(--ccr-text)]">{formatJmd(0)}</p>
                          <p className="mt-1 text-sm text-[var(--ccr-muted)]">No additional charge</p>
                          <p className="mt-1 text-sm text-transparent select-none" aria-hidden="true">
                            {formatJmd(0)} total · {rentalDays} day{rentalDays === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="mt-4 flex-1 border-t border-[var(--ccr-border)] pt-4">
                          <p className="text-sm leading-7 text-[var(--ccr-muted)]">
                            No insurance will be added to this booking. The renter is responsible for the full cost
                            of any damage, including any loss of use.
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!standardProtectionAvailable) return;
                          resetMessages();
                          setProtectionChoice("STANDARD");
                        }}
                        disabled={!standardProtectionAvailable}
                        className={`flex h-full min-w-0 flex-col rounded-2xl border p-5 text-left transition ${
                          !standardProtectionAvailable
                            ? "cursor-not-allowed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] opacity-45"
                            : protectionChoice === "STANDARD"
                              ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 shadow-[0_0_0_1px_rgba(245,199,88,0.2)]"
                              : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] hover:border-[var(--ccr-accent)]/40"
                        }`}
                      >
                        <div className="flex min-h-[11.5rem] items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-lg font-semibold text-[var(--ccr-text)]">Standard Protection</p>
                            {insuranceLoading ? (
                              <div className="mt-2">
                                <p className="text-sm text-[var(--ccr-muted)]">Checking protection pricing…</p>
                              </div>
                            ) : standardProtectionAvailable ? (
                              <>
                                <p className="mt-2 text-3xl font-bold text-[var(--ccr-text)]">
                                  {formatJmd(insurancePricePerDay)}
                                  <span className="ml-1 text-base font-medium text-[var(--ccr-muted)]">/day</span>
                                </p>
                                <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                                  {formatJmd(standardProtectionTotal)} total · {rentalDays} day{rentalDays === 1 ? "" : "s"}
                                </p>
                              </>
                            ) : (
                              <div className="mt-2">
                                <p className="text-sm text-[var(--ccr-muted)]">Unavailable for this vehicle</p>
                              </div>
                            )}
                          </div>
                          {!standardProtectionAvailable ? (
                            <span className="rounded-full border border-[var(--ccr-border)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ccr-muted)]">
                              Unavailable
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 flex-1 border-t border-[var(--ccr-border)] pt-4">
                          <p className="text-sm font-semibold text-[var(--ccr-text)]">
                            Coverage: {formatJmd(insuranceCoverage)}
                          </p>
                          <p className="mt-2 text-sm leading-7 text-[var(--ccr-muted)]">
                            With this option, the renter pays an additional daily fee to reduce their financial exposure. If the vehicle is damaged, the renter&apos;s maximum out-of-pocket cost is capped at {formatJmd(insuranceCoverage)}.
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              {step === 4 ? (
                <section className="min-w-0">
                  <div className="flex min-w-0 flex-col items-start gap-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
                    <div className="min-w-0">
                      <h2 className="break-words text-xl font-bold text-[var(--ccr-text)]">Customer Information</h2>
                      <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                        Enter your details and driver&apos;s license information.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReturningStage("lookup");
                        setReturningError(null);
                        setReturningTurnstileToken(null);
                        setReturningTurnstileResetKey((value) => value + 1);
                        setShowReturningCustomerModal(true);
                      }}
                      className="w-full rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] sm:w-auto"
                    >
                      Returning Customer?
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                    Enter your Driver&apos;s License number to prefill your details.
                  </p>

                  <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">First Name *</span>
                      <input
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Last Name *</span>
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Email Address *</span>
                      <input
                        type="email"
                        value={emailAddress}
                        onChange={(event) => setEmailAddress(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Phone Number *</span>
                      <input
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Street</span>
                      <input
                        value={street}
                        onChange={(event) => setStreet(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Street 2</span>
                      <input
                        value={street2}
                        onChange={(event) => setStreet2(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">City</span>
                      <input
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Parish / Region</span>
                      <input
                        value={parish}
                        onChange={(event) => setParish(event.target.value)}
                        list="jamaica-parish-suggestions"
                        placeholder={isJamaicaCountry(country) ? "e.g. St. Andrew" : "e.g. Ontario"}
                        className={bookingFieldClassName}
                      />
                      <datalist id="jamaica-parish-suggestions">
                        {JAMAICA_PARISHES.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Country</span>
                      <input
                        value={country}
                        onChange={(event) => setCountry(event.target.value)}
                        placeholder="Jamaica"
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Birthday</span>
                      <input
                        type="date"
                        value={birthday}
                        onChange={(event) => setBirthday(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-6 min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                    <p className="text-base font-semibold text-[var(--ccr-text)]">
                      Driver&apos;s License
                    </p>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                      Driver&apos;s license details are optional.
                    </p>
                    <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
                      <label className="block min-w-0">
                        <span className="text-sm font-semibold text-[var(--ccr-muted)]">DL Number</span>
                        <input
                          value={driversLicenseNumber}
                          onChange={(event) => setDriversLicenseNumber(event.target.value)}
                          className={bookingSoftFieldClassName}
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="text-sm font-semibold text-[var(--ccr-muted)]">
                          Expiration Date
                        </span>
                        <input
                          type="date"
                          value={driversLicenseExpirationDate}
                          onChange={(event) => setDriversLicenseExpirationDate(event.target.value)}
                          className={bookingSoftFieldClassName}
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={driversLicenseUploading}
                        className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60 sm:w-auto"
                      >
                        {driversLicenseUploading ? "Uploading..." : "Upload from phone/computer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={driversLicenseUploading}
                        className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60 sm:w-auto"
                      >
                        Take photo
                      </button>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={onDriversLicenseFilePicked}
                        className="hidden"
                      />
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={onDriversLicenseFilePicked}
                        className="hidden"
                      />
                    </div>
                    {driversLicenseImageUrls.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-sm text-emerald-700">
                          {driversLicenseImageUrls.length} driver&apos;s license{" "}
                          {driversLicenseImageUrls.length === 1 ? "image" : "images"} attached.
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {driversLicenseImageUrls.map((imageUrl, index) => (
                            <div
                              key={`${imageUrl.slice(-24)}-${index}`}
                              className="overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
                            >
                              <NextImage
                                src={imageUrl}
                                alt={`Driver's license image ${index + 1}`}
                                width={240}
                                height={144}
                                unoptimized
                                className="aspect-[5/3] w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setDriversLicenseImageUrls((current) =>
                                    current.filter((_, imageIndex) => imageIndex !== index),
                                  )
                                }
                                className="w-full border-t border-[var(--ccr-border)] px-2 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                          Up to {MAX_DRIVERS_LICENSE_IMAGES} images can be attached.
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                        Optional: upload front, back, or supporting driver&apos;s license images.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}

              {step === 5 ? (
                <section className="min-w-0">
                  <h2 className="break-words text-xl font-bold text-[var(--ccr-text)]">Confirm Reservation</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Review your details, sign, and proceed to payment.
                  </p>

                  <div className="mt-5 min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4 text-sm text-[var(--ccr-muted)]">
                    <p className="break-words">
                      <span className="font-semibold text-[var(--ccr-text)]">Vehicle:</span>{" "}
                      {summaryVehicleLabel}
                    </p>
                    <p className="mt-1 break-words">
                      <span className="font-semibold text-[var(--ccr-text)]">Pickup:</span> {pickupDate}{" "}
                      {pickupTime} · {pickupLocationText}
                    </p>
                    <p className="mt-1 break-words">
                      <span className="font-semibold text-[var(--ccr-text)]">Dropoff:</span> {dropoffDate}{" "}
                      {dropoffTime} · {dropoffLocationText}
                    </p>
                    <p className="mt-1 break-words">
                      <span className="font-semibold text-[var(--ccr-text)]">Customer:</span> {firstName}{" "}
                      {lastName}
                    </p>
                  </div>

                  <div className="mt-5 min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
                    <p className="text-sm font-semibold text-[var(--ccr-text)]">Signature *</p>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      Sign clearly inside the box using your finger or mouse.
                    </p>
                    <canvas
                      ref={signatureCanvasRef}
                      className="mt-2 h-40 w-full touch-none rounded-xl border-2 border-[var(--ccr-accent)]/45 bg-[var(--ccr-surface-soft)] shadow-inner"
                      onPointerDown={beginSignature}
                      onPointerMove={drawSignature}
                      onPointerUp={endSignature}
                      onPointerLeave={endSignature}
                      onPointerCancel={endSignature}
                    />
                    <div className="mt-3 flex min-w-0 flex-col items-start gap-2 min-[430px]:flex-row min-[430px]:items-center">
                      <button
                        type="button"
                        onClick={clearSignature}
                        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                      >
                        Clear signature
                      </button>
                      {signatureDataUrl ? (
                        <span className="text-xs font-semibold text-emerald-700">
                          Signature captured
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-rose-600">
                          Signature required
                        </span>
                      )}
                    </div>
                  </div>

                  <label className="mt-4 flex items-start gap-2 text-sm text-[var(--ccr-muted)]">
                    <input
                      type="checkbox"
                      checked={acceptTerms}
                      onChange={(event) => setAcceptTerms(event.target.checked)}
                      style={{ accentColor: "var(--ccr-accent)" }}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-sm outline-none ring-[var(--ccr-accent)]/35 transition focus-visible:ring-2"
                    />
                    <span>
                      By clicking here, I confirm that I accept the privacy policy and terms.
                    </span>
                  </label>
                </section>
              ) : null}

              {step === 6 ? (
                <section className="min-w-0" data-testid="booking-step-payments">
                  <h2 className="break-words text-xl font-bold text-[var(--ccr-text)]">Payments</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    {`Choose your payment option in JMD. Step 7 launches hosted ${hostedPaymentProvider} checkout.`}
                  </p>
                  {step6VehicleWarning ? (
                    <div
                      className="mt-4 rounded-xl border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] px-4 py-3 text-sm text-[var(--ccr-clerk-danger-text)]"
                      data-testid="booking-step6-vehicle-warning"
                    >
                      {step6VehicleWarning}
                    </div>
                  ) : null}
                  {step6PricingWarning ? (
                    <div
                      className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm text-[var(--ccr-text)]"
                      data-testid="booking-step6-pricing-warning"
                    >
                      {step6PricingWarning}
                    </div>
                  ) : null}
                  {vehicleRefreshWarning ? (
                    <div
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                      data-testid="booking-step6-refresh-warning"
                    >
                      {vehicleRefreshWarning}
                    </div>
                  ) : null}

                  <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setPaymentOption("DEPOSIT")}
                      className={cn(
                        "min-w-0 rounded-2xl border px-4 py-3 text-left",
                        paymentOption === "DEPOSIT"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]",
                      )}
                    >
                      <p className="font-semibold text-[var(--ccr-text)]">Pay Deposit</p>
                      <p className="text-sm text-[var(--ccr-muted)]">{formatJmd(depositRequired)} due now</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentOption("FULL")}
                      className={cn(
                        "min-w-0 rounded-2xl border px-4 py-3 text-left",
                        paymentOption === "FULL"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]",
                      )}
                    >
                      <p className="font-semibold text-[var(--ccr-text)]">Pay Full Amount</p>
                      <p className="text-sm text-[var(--ccr-muted)]">{formatJmd(amountDue)} due now</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentOption("CUSTOM")}
                      className={cn(
                        "min-w-0 rounded-2xl border px-4 py-3 text-left",
                        paymentOption === "CUSTOM"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]",
                      )}
                    >
                      <p className="font-semibold text-[var(--ccr-text)]">Custom Payment</p>
                      <p className="text-sm text-[var(--ccr-muted)]">Enter a custom amount to pay now</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentOption("NONE")}
                      className={cn(
                        "min-w-0 rounded-2xl border px-4 py-3 text-left",
                        paymentOption === "NONE"
                          ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]",
                      )}
                    >
                      <p className="font-semibold text-[var(--ccr-text)]">No Payment</p>
                      <p className="text-sm text-[var(--ccr-muted)]">Pay at pickup</p>
                    </button>
                  </div>

                  {paymentOption === "CUSTOM" ? (
                    <label className="mt-4 block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Custom Amount (JMD)</span>
                      <input
                        type="number"
                        min={1}
                        max={amountDue}
                        step={1}
                        value={customPaymentAmount}
                        onChange={(event) => setCustomPaymentAmount(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                  ) : null}

                  {paymentWarning ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {paymentWarning}
                    </div>
                  ) : null}

                  {refundableSecurityDepositJmd > 0 ? (
                    <div
                      className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm text-[var(--ccr-text)]"
                      data-testid="booking-refundable-security-deposit"
                    >
                      This vehicle requires a refundable security deposit of JMD{" "}
                      {formatJmd(refundableSecurityDepositJmd)}. This amount is collected at pickup
                      and is not charged during online booking.
                    </div>
                  ) : null}

                  <div
                    className="mt-4 min-w-0 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3 sm:p-4"
                    data-testid="booking-security-check"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Security Check
                    </p>
                    <TurnstileWidget
                      action="public_booking"
                      onTokenChange={setTurnstileToken}
                      resetKey={turnstileResetKey}
                      devBypassEnabled={turnstileDevBypassEnabled}
                      className="mt-2"
                    />
                    {step6SecurityHint ? (
                      <p
                        className="mt-2 text-xs text-[var(--ccr-muted)]"
                        data-testid="booking-step6-security-hint"
                      >
                        {step6SecurityHint}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={submitBooking}
                      disabled={continueToPaymentDisabled}
                      className={cn("w-full justify-center sm:w-auto", bookingPrimaryButtonClassName)}
                      data-testid="booking-continue-payment"
                    >
                      {submitting
                        ? "Submitting..."
                        : paymentOption === "NONE"
                          ? "Confirm Booking"
                          : `Continue to ${hostedPaymentProvider}`}
                    </button>
                  </div>
                </section>
              ) : null}

              {errorMessage ? (
                <p className="mt-4 rounded-[1.1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </p>
              ) : null}
              {statusMessage ? (
                <p
                  className={cn(
                    "mt-4 break-words rounded-[1.1rem] border px-4 py-3 text-sm",
                    statusIsDraftRestoreNotice
                      ? "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)] shadow-sm shadow-black/5"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800",
                  )}
                >
                  {statusMessage}
                </p>
              ) : null}

              <div className="mt-8 flex flex-col gap-3 border-t border-[var(--ccr-border)] pt-6 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  onClick={() => setShowStartOverConfirm(true)}
                  disabled={submitting}
                  className={cn("w-full justify-center sm:w-auto", bookingResetButtonClassName)}
                  data-testid="booking-start-over"
                >
                  Start over
                </button>
                <button
                  type="button"
                  onClick={moveToPreviousStep}
                  disabled={step === 1 || submitting}
                  className={cn("w-full justify-center sm:w-auto", bookingOutlineButtonClassName)}
                >
                  Back
                </button>
                {step < 6 ? (
                  <button
                    type="button"
                    onClick={() => void moveToNextStep()}
                    disabled={submitting}
                    className={cn("w-full justify-center sm:w-auto", bookingPrimaryButtonClassName)}
                  >
                    Next Step
                  </button>
                ) : null}
              </div>
            </div>

            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-[var(--ccr-border)] bg-[linear-gradient(160deg,var(--ccr-primary),rgba(15,23,42,0.96))] px-3.5 py-4 text-[var(--ccr-on-primary)] shadow-[0_28px_90px_rgba(15,23,42,0.2)] sm:rounded-[1.75rem] sm:px-4 sm:py-5 md:px-6 md:py-6">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
                Booking summary
              </p>
              <h3 className="mt-3 text-[1.65rem] font-semibold tracking-tight sm:text-2xl">Review before checkout</h3>
              <p className="mt-3 break-words text-sm leading-6 text-[var(--ccr-on-primary-muted)]">
                Use these controls to update your itinerary or change the vehicle before final payment.
              </p>
              <div className="-mx-1 mt-4 min-w-0 overflow-x-auto pb-1 sm:mx-0 sm:overflow-visible">
                <div className="flex min-w-max items-center gap-1.5 px-1 sm:min-w-0 sm:flex-wrap sm:px-0">
                  <button
                    type="button"
                    onClick={handleChangeDates}
                    className="shrink-0 whitespace-nowrap rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] font-semibold leading-5 text-[var(--ccr-on-primary)] backdrop-blur-sm sm:text-xs"
                    data-testid="booking-summary-change-dates"
                  >
                    Change dates
                  </button>
                  <button
                    type="button"
                    onClick={handleChangeVehicle}
                    className="shrink-0 whitespace-nowrap rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] font-semibold leading-5 text-[var(--ccr-on-primary)] backdrop-blur-sm sm:text-xs"
                    data-testid="booking-summary-change-vehicle"
                  >
                    Change vehicle
                  </button>
                  {hasSelectedVehicleId ? (
                    <button
                      type="button"
                      onClick={handleDeselectVehicle}
                      className="shrink-0 whitespace-nowrap rounded-full border border-[var(--ccr-clerk-danger-border)] bg-white/6 px-3 py-1.5 text-[11px] font-semibold leading-5 text-[var(--ccr-clerk-danger-text)] sm:text-xs"
                      data-testid="booking-summary-deselect-vehicle"
                    >
                      Deselect vehicle
                    </button>
                  ) : null}
                  {draftWasRestored ? (
                    <button
                      type="button"
                      onClick={() => setShowStartOverConfirm(true)}
                      className="shrink-0 whitespace-nowrap rounded-full border border-[var(--ccr-clerk-danger-border)] bg-white/6 px-3 py-1.5 text-[11px] font-semibold leading-5 text-[var(--ccr-clerk-danger-text)] sm:text-xs"
                      data-testid="booking-summary-start-over"
                    >
                      Clear draft
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-5 min-w-0 space-y-3 rounded-[1.35rem] border border-white/10 bg-white/6 p-4 text-sm shadow-inner shadow-black/10">
                <p className="break-words">
                  <span className="text-[var(--ccr-on-primary-muted)]">Pickup:</span> {pickupDate} {pickupTime}
                </p>
                <p className="break-words">
                  <span className="text-[var(--ccr-on-primary-muted)]">Dropoff:</span> {dropoffDate} {dropoffTime}
                </p>
                <p className="break-words">
                  <span className="text-[var(--ccr-on-primary-muted)]">Pickup Location:</span>{" "}
                  {pickupLocationText || "Not selected"}
                </p>
                <p className="break-words">
                  <span className="text-[var(--ccr-on-primary-muted)]">Dropoff Location:</span>{" "}
                  {dropoffLocationText || "Not selected"}
                </p>
                <p className="break-words">
                  <span className="text-[var(--ccr-on-primary-muted)]">Vehicle:</span>{" "}
                  {summaryVehicleLabel}
                </p>
              </div>

              <div className="mt-6 min-w-0 rounded-[1.5rem] border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-on-primary-muted)]">Pricing (JMD)</p>
                {pricingQuoteLoading ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="animate-pulse text-[var(--ccr-on-primary-muted)]">Updating...</p>
                    <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--ccr-on-primary)]/20" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--ccr-on-primary)]/20" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--ccr-on-primary)]/20" />
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 text-sm">
                    {hideFallbackTotals ? (
                      <p className="text-xs text-[var(--ccr-on-primary-muted)]">Calculating...</p>
                    ) : null}
                    {pricingQuoteUpdating ? (
                      <p className="text-xs text-[var(--ccr-on-primary-muted)]">Updating...</p>
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Days</span>
                      <span className="shrink-0 text-right font-semibold">{hideFallbackTotals ? "—" : rentalDays}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Base rental</span>
                      <span className="shrink-0 text-right font-semibold">{hideFallbackTotals ? "—" : formatJmd(baseTotal)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Insurance</span>
                      <span className="shrink-0 text-right font-semibold">{hideFallbackTotals ? "—" : formatJmd(insuranceTotal)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Coupon</span>
                      <span className="shrink-0 text-right font-semibold">{hideFallbackTotals ? "—" : `-${formatJmd(discountTotal)}`}</span>
                    </div>
                    <div className="my-2 h-px bg-[var(--ccr-border)]" />
                    <div className="flex items-start justify-between gap-3 text-base">
                      <span className="min-w-0 font-semibold">Total</span>
                      <span className="shrink-0 text-right font-bold">{hideFallbackTotals ? "—" : formatJmd(amountDue)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Minimum Deposit to Reserve</span>
                      <span className="shrink-0 text-right font-semibold">{hideFallbackTotals ? "—" : formatJmd(depositRequired)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Due Now</span>
                      <span className="shrink-0 text-right font-semibold">
                        {hideFallbackTotals ? "—" : formatJmd(paymentPreviewDueNow)}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">Balance Due on Pickup</span>
                      <span className="shrink-0 text-right font-semibold">{hideFallbackTotals ? "—" : formatJmd(balanceDueOnPickup)}</span>
                    </div>
                    {reserveShortfall > 0 && !hideFallbackTotals ? (
                      <p className="text-xs text-amber-200">
                        Pay {formatJmd(reserveShortfall)} more to meet the minimum deposit.
                      </p>
                    ) : null}
                  </div>
                )}
                {pricingQuoteError ? (
                  <p className="mt-3 text-xs text-amber-200">{pricingQuoteError}</p>
                ) : null}
              </div>
              <div className="mt-6 min-w-0 rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
                  Need assistance?
                </p>
                <p className="mt-3 break-words text-sm leading-6 text-[var(--ccr-on-primary-muted)]">
                  Contact the Curated Car Rentals team at {siteContent.phones[0]?.label} if you need help before checkout.
                </p>
              </div>
              </div>
            </aside>
          </div>
          </div>
        </Container>
      </div>

      {showReturningCustomerModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ccr-primary)]/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[calc(100vw-2rem)] rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_28px_90px_rgba(15,23,42,0.22)] sm:max-w-md sm:p-6">
            <h4 className="text-lg font-bold text-[var(--ccr-text)]">Returning Customer</h4>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              Verify with your Driver&apos;s License number before prefilling details.
            </p>

            {returningStage === "lookup" ? (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Driver&apos;s License or ID Number</span>
                  <input
                    value={returningDlInput}
                    onChange={(event) => setReturningDlInput(event.target.value)}
                    className={bookingFieldClassName}
                  />
                </label>
                <button
                  type="button"
                  onClick={startReturningCustomerLookup}
                  disabled={returningBusy || !returningTurnstileToken}
                  className={cn("w-full", bookingPrimaryButtonClassName)}
                >
                  {returningBusy ? "Checking..." : "Continue"}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Driver&apos;s License or ID Number</span>
                  <input
                    value={returningDlInput}
                    readOnly
                    className={bookingReadonlyFieldClassName}
                  />
                </label>
                <p className="text-xs text-[var(--ccr-muted)]">
                  Enter the code we sent and confirm your last name.
                </p>
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">One-Time Code</span>
                  <input
                    value={returningOtpCode}
                    onChange={(event) => setReturningOtpCode(event.target.value)}
                    className={bookingFieldClassName}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Last Name</span>
                  <input
                    value={returningLastName}
                    onChange={(event) => setReturningLastName(event.target.value)}
                    className={bookingFieldClassName}
                  />
                </label>
                <button
                  type="button"
                  onClick={verifyReturningCustomer}
                  disabled={returningBusy || !returningTurnstileToken}
                  className={cn("w-full", bookingPrimaryButtonClassName)}
                >
                  {returningBusy ? "Verifying..." : "Verify & Prefill"}
                </button>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Security Check
              </p>
              <TurnstileWidget
                action="public_returning_customer"
                onTokenChange={setReturningTurnstileToken}
                resetKey={returningTurnstileResetKey}
                devBypassEnabled={turnstileDevBypassEnabled}
                className="mt-2"
              />
            </div>

            {returningError ? <p className="mt-3 text-sm text-rose-600">{returningError}</p> : null}

            <button
              type="button"
              onClick={() => {
                setReturningTurnstileToken(null);
                setReturningTurnstileResetKey((value) => value + 1);
                setShowReturningCustomerModal(false);
              }}
              className={cn("mt-4 w-full", bookingOutlineButtonClassName)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {showStartOverConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ccr-primary)]/65 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-[calc(100vw-2rem)] rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_28px_90px_rgba(15,23,42,0.22)] sm:max-w-md sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-start-over-title"
            aria-describedby="booking-start-over-description"
            data-testid="booking-start-over-dialog"
          >
            <h4 id="booking-start-over-title" className="text-lg font-bold text-[var(--ccr-text)]">
              Start over?
            </h4>
            <p id="booking-start-over-description" className="mt-2 text-sm text-[var(--ccr-muted)]">
              This will clear your current draft and you&apos;ll restart from the beginning.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowStartOverConfirm(false)}
                className={cn("w-full justify-center sm:w-auto", bookingOutlineButtonClassName)}
                data-testid="booking-start-over-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartOver}
                className={cn("w-full justify-center sm:w-auto", bookingResetButtonClassName)}
                data-testid="booking-start-over-confirm"
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Container className="mt-5 sm:hidden">
        {bookingSupportHighlights}
      </Container>
    </div>
  );
}
