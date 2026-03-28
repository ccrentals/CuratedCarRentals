"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";

import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { PublicVehicleOptionCard } from "@/components/booking/PublicVehicleOptionCard";
import { Container } from "@/components/site/Container";
import { PublicPageIntro } from "@/components/site/PublicPageIntro";
import { siteContent } from "@/data/content";
import { clearBookingDraft } from "@/lib/bookings/draft";
import {
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
  JAMAICA_PARISHES,
  isJamaicaCountry,
  normalizeCountryName,
  normalizeJamaicaParish,
} from "@/lib/jamaicaParishes";
import { calcDaysInclusive } from "@/lib/payments/dateMath";
import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";
import { isEmail, isNonEmptyString } from "@/lib/validators";

type LocationOption = {
  id: string;
  label: string;
  allowPickup: boolean;
  allowDropoff: boolean;
};

type PublicVehicle = {
  id: string;
  name: string;
  make: string;
  model: string;
  year: number;
  daily_rate_cents: number;
  deposit_cents: number;
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
  balanceDue: number;
  paymentOption: "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";
  promoCode: string | null;
};

type PricingQuoteResponse = {
  ok?: boolean;
  error?: string;
  summary?: PricingQuoteSummary;
};

type BookingCreateResponse = {
  bookingId?: string;
  bookingAccessToken?: string;
  error?: string;
};

type PublicLocationsResponse = {
  locations?: Array<{
    id?: string;
    label?: string;
    allow_pickup?: boolean;
    allow_dropoff?: boolean;
  }>;
};

type PublicInsuranceResponse = {
  insurance?: {
    enabled?: boolean;
    planId?: string | null;
    pricePerDayCents?: number;
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
  pickupCustomAddress?: string;
  dropoffCustomAddress?: string;
  selectedVehicleId?: string;
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
const CHECKOUT_STEP = { step: 7, title: "WiPay" } as const;

const CUSTOM_PICKUP_ID = "__CUSTOM_PICKUP__";
const CUSTOM_DROPOFF_ID = "__CUSTOM_DROPOFF__";
const WIZARD_DRAFT_STORAGE_KEY = "ccr_booking_wizard_draft_v1";
const WIZARD_DEBUG_ENABLED = process.env.NEXT_PUBLIC_WIZARD_DEBUG === "1";

const bookingFieldClassName =
  "mt-2 w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-3 text-sm text-[var(--ccr-text)] shadow-sm shadow-black/5 outline-none ring-[var(--ccr-accent)] transition focus:ring-2";
const bookingSoftFieldClassName =
  "mt-2 w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm text-[var(--ccr-text)] shadow-sm shadow-black/5 outline-none ring-[var(--ccr-accent)] transition focus:ring-2";
const bookingReadonlyFieldClassName =
  "mt-2 w-full rounded-[1.1rem] border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-4 py-3 text-sm text-[var(--ccr-text)] shadow-sm shadow-black/5";
const bookingPrimaryButtonClassName =
  "rounded-[1rem] bg-[var(--ccr-primary)] px-5 py-3 text-sm font-semibold text-[var(--ccr-on-primary)] transition hover:bg-[var(--ccr-primary-soft)] disabled:opacity-60";
const bookingOutlineButtonClassName =
  "rounded-[1rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ccr-text)] transition hover:bg-[var(--ccr-surface-soft)] disabled:opacity-40";
const bookingResetButtonClassName =
  "rounded-[1rem] border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)] disabled:opacity-40";

const DEFAULT_LOCATIONS: LocationOption[] = [
  {
    id: "HQ",
    label: "168 1/2 Old Hope Road, Kingston Jamaica",
    allowPickup: true,
    allowDropoff: true,
  },
  {
    id: "NORMAN_MANLEY_AIRPORT",
    label: "Norman Manley Airport",
    allowPickup: true,
    allowDropoff: true,
  },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateInputForOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

function normalizeText(value: string) {
  return value.trim();
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
  if (normalizeText(draft.pickupCustomAddress ?? "").length > 0) return true;
  if (normalizeText(draft.dropoffCustomAddress ?? "").length > 0) return true;
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

export function PublicBookingWizard({ turnstileDevBypassEnabled = false }: PublicBookingWizardProps) {
  const router = useRouter();
  const [requestedVehicleFromQuery, setRequestedVehicleFromQuery] = useState("");
  const draftHydratedRef = useRef(false);
  const preselectedVehicleIdRef = useRef("");
  const initialPickupDateRef = useRef(dateInputForOffset(0));
  const initialDropoffDateRef = useRef(dateInputForOffset(2));

  const [step, setStep] = useState<WizardStep>(1);
  const [maxStepCompleted, setMaxStepCompleted] = useState<WizardStep>(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draftWasRestored, setDraftWasRestored] = useState(false);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);

  const [pickupDate, setPickupDate] = useState(() => initialPickupDateRef.current);
  const [pickupTime, setPickupTime] = useState("11:00");
  const [dropoffDate, setDropoffDate] = useState(() => initialDropoffDateRef.current);
  const [dropoffTime, setDropoffTime] = useState("11:00");

  const [locationOptions, setLocationOptions] = useState<LocationOption[]>(DEFAULT_LOCATIONS);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [pickupLocationId, setPickupLocationId] = useState(DEFAULT_LOCATIONS[0]?.id ?? "");
  const [dropoffLocationId, setDropoffLocationId] = useState(DEFAULT_LOCATIONS[0]?.id ?? "");
  const [pickupCustomAddress, setPickupCustomAddress] = useState("");
  const [dropoffCustomAddress, setDropoffCustomAddress] = useState("");

  const [vehicleOptions, setVehicleOptions] = useState<PublicVehicle[]>([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicleSelectionUnavailable, setVehicleSelectionUnavailable] = useState(false);

  const [insuranceSelected, setInsuranceSelected] = useState(false);
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [insurancePlanId, setInsurancePlanId] = useState<string | null>(null);
  const [insurancePricePerDay, setInsurancePricePerDay] = useState(0);
  const [insuranceLoading, setInsuranceLoading] = useState(false);

  const [couponCode, setCouponCode] = useState("");
  const [couponAppliedCode, setCouponAppliedCode] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponBusy, setCouponBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pricingState, setPricingState] = useState(() =>
    createPricingLifecycleState<PricingQuoteSummary>(),
  );
  const selectedVehicleIdRef = useRef("");
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
  const [driversLicenseImageUrl, setDriversLicenseImageUrl] = useState("");
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
  const [returningBirthday, setReturningBirthday] = useState("");
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
          insuranceSelected,
          paymentOption,
        },
      );
      setStep(restoredStep);
      setMaxStepCompleted(
        restoredMaxStep > restoredStep ? restoredMaxStep : restoredStep,
      );
      setPickupDate(restoredSelections.pickupDate);
      setPickupTime(restoredSelections.pickupTime);
      setDropoffDate(restoredSelections.dropoffDate);
      setDropoffTime(restoredSelections.dropoffTime);
      setPickupLocationId(restoredSelections.pickupLocationId);
      setDropoffLocationId(restoredSelections.dropoffLocationId);
      setSelectedVehicleId(restoredSelections.selectedVehicleId);
      setInsuranceSelected(restoredSelections.insuranceSelected);
      setPaymentOption(restoredSelections.paymentOption);
      if (typeof draft.pickupCustomAddress === "string") setPickupCustomAddress(draft.pickupCustomAddress);
      if (typeof draft.dropoffCustomAddress === "string") setDropoffCustomAddress(draft.dropoffCustomAddress);
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
      setDriversLicenseImageUrl(security.driversLicenseImageUrl);
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
    dropoffDate,
    dropoffLocationId,
    dropoffTime,
    insuranceSelected,
    paymentOption,
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
      pickupCustomAddress,
      dropoffCustomAddress,
      selectedVehicleId,
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
      pickupTime !== "11:00" ||
      dropoffDate !== initialDropoffDateRef.current ||
      dropoffTime !== "11:00" ||
      normalizeText(pickupCustomAddress).length > 0 ||
      normalizeText(dropoffCustomAddress).length > 0 ||
      normalizeText(selectedVehicleId).length > 0 ||
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
    dropoffCustomAddress,
    dropoffDate,
    dropoffLocationId,
    dropoffTime,
    emailAddress,
    firstName,
    insuranceSelected,
    lastName,
    paymentOption,
    parish,
    phoneNumber,
    pickupCustomAddress,
    pickupDate,
    pickupLocationId,
    pickupTime,
    selectedVehicleId,
    step,
    maxStepCompleted,
    hydrated,
    street,
    street2,
    clearWizardDraft,
  ]);

  const pickupOptions = useMemo(
    () => [
      ...locationOptions.filter((location) => location.allowPickup),
      { id: CUSTOM_PICKUP_ID, label: "Pick up Address", allowPickup: true, allowDropoff: false },
    ],
    [locationOptions],
  );
  const dropoffOptions = useMemo(
    () => [
      ...locationOptions.filter((location) => location.allowDropoff),
      {
        id: CUSTOM_DROPOFF_ID,
        label: "Return Address",
        allowPickup: false,
        allowDropoff: true,
      },
    ],
    [locationOptions],
  );

  const selectedVehicle = useMemo(
    () => vehicleOptions.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [vehicleOptions, selectedVehicleId],
  );
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

  const rentalDays = pricingQuote?.days ?? calcDaysInclusive(pickupDate, dropoffDate);
  const baseTotal = pricingQuote?.baseTotal ?? (selectedVehicle ? selectedVehicle.daily_rate_cents * rentalDays : 0);
  const insuranceTotal = pricingQuote?.insuranceTotal ?? (insuranceSelected ? rentalDays * insurancePricePerDay : 0);
  const discountTotal = pricingQuote?.discountTotal ?? Math.max(0, Math.min(baseTotal + insuranceTotal, couponDiscount));
  const amountDue = pricingQuote?.amountDue ?? Math.max(0, baseTotal + insuranceTotal - discountTotal);
  const depositRequired = pricingQuote?.depositRequired ?? (selectedVehicle ? selectedVehicle.deposit_cents : 0);
  const balanceDueOnPickup = pricingQuote?.balanceDue ?? Math.max(0, amountDue - depositRequired);

  const customPaymentNumber = Number(customPaymentAmount);
  const customPaymentIsValid =
    Number.isFinite(customPaymentNumber) && customPaymentNumber > 0 && customPaymentNumber <= amountDue;

  const pickupAt = combineDateTime(pickupDate, pickupTime);
  const dropoffAt = combineDateTime(dropoffDate, dropoffTime);
  const datesValid = pickupAt !== null && dropoffAt !== null && dropoffAt > pickupAt;

  const pickupLocationText = useMemo(() => {
    if (pickupLocationId === CUSTOM_PICKUP_ID) return normalizeText(pickupCustomAddress);
    return pickupOptions.find((location) => location.id === pickupLocationId)?.label ?? "";
  }, [pickupCustomAddress, pickupLocationId, pickupOptions]);

  const dropoffLocationText = useMemo(() => {
    if (dropoffLocationId === CUSTOM_DROPOFF_ID) return normalizeText(dropoffCustomAddress);
    return dropoffOptions.find((location) => location.id === dropoffLocationId)?.label ?? "";
  }, [dropoffCustomAddress, dropoffLocationId, dropoffOptions]);
  const deliverySelected =
    pickupLocationId === CUSTOM_PICKUP_ID || dropoffLocationId === CUSTOM_DROPOFF_ID;
  const deliveryZoneLabel = [pickupLocationText, dropoffLocationText].filter(Boolean).join(" → ");

  const loadAvailableVehicles = useCallback(
    async (options?: { reason?: "effect" | "revalidate" | "select"; force?: boolean }) => {
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
        let nextVehicleUnavailable = false;

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

        if (
          nextSelectedVehicleId &&
          !mapped.some((vehicle) => vehicle.id === nextSelectedVehicleId)
        ) {
          nextVehicleUnavailable = true;
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

        lastVehiclesSuccessKeyRef.current = vehiclesKey;
        setVehicleOptions(mapped);
        setVehicleSelectionUnavailable(nextVehicleUnavailable);
        setSelectedVehicleId(nextSelectedVehicleId);
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

        const parsedLocations = Array.isArray(data.locations)
          ? data.locations
              .filter(
                (location): location is {
                  id: string;
                  label: string;
                  allow_pickup?: boolean;
                  allow_dropoff?: boolean;
                } =>
                  typeof location.id === "string" &&
                  typeof location.label === "string" &&
                  location.label.trim().length > 0,
              )
              .map((location) => ({
                id: location.id,
                label: location.label.trim(),
                allowPickup: location.allow_pickup !== false,
                allowDropoff: location.allow_dropoff !== false,
              }))
          : [];

        const next = parsedLocations.length > 0 ? parsedLocations : DEFAULT_LOCATIONS;
        if (cancelled) return;
        setLocationOptions(next);

        setPickupLocationId((current) => {
          if (current === CUSTOM_PICKUP_ID) return current;
          return next.some((location) => location.id === current) ? current : (next[0]?.id ?? "");
        });
        setDropoffLocationId((current) => {
          if (current === CUSTOM_DROPOFF_ID) return current;
          return next.some((location) => location.id === current) ? current : (next[0]?.id ?? "");
        });
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
    let cancelled = false;
    async function loadInsurance() {
      if (!hydrated) return;
      if (!selectedVehicleId) {
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
        setInsuranceSelected(false);
        return;
      }
      if (!selectedVehicle || vehicleSelectionUnavailable) {
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
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
        if (!enabled) {
          setInsuranceSelected(false);
        }
      } catch {
        if (cancelled) return;
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
        setInsuranceSelected(false);
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

    const quoteKey = JSON.stringify({
      vehicleId: selectedVehicleId,
      startAt: pickup.toISOString(),
      endAt: dropoff.toISOString(),
      insuranceSelected: insuranceEnabled && insuranceSelected,
      promoCode: couponAppliedCode,
      paymentOption,
      customAmount: paymentOption === "CUSTOM" ? customPaymentAmount : null,
      customerEmail: normalizeText(emailAddress),
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
    if (shouldClearVehicleOptions) setVehicleOptions([]);
    setInsuranceSelected(false);
    setInsuranceEnabled(false);
    setInsurancePlanId(null);
    setInsurancePricePerDay(0);
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

  const step1Complete = datesValid && Boolean(pickupLocationText) && Boolean(dropoffLocationText);
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
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
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
      if (!datesValid) {
        setErrorMessage("Return date and time must be later than pickup date and time.");
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
    setVehicleLoading(true);
    const available = await revalidateSelectedVehicleAvailability(vehicleId);
    if (available) {
      setSelectedVehicleId(vehicleId);
      setVehicleSelectionUnavailable(false);
      setStatusMessage("Vehicle selected and availability confirmed.");
    }
    setVehicleLoading(false);
  }

  function handleDeselectVehicle() {
    resetMessages();
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
    setStep(nextStep);
    setMaxStepCompleted((previous) => (nextStep > previous ? nextStep : previous));
  }

  function moveToPreviousStep() {
    resetMessages();
    setStep((current) => (current > 1 ? ((current - 1) as WizardStep) : current));
  }

  function handleChangeDates() {
    resetMessages();
    setStep(1);
    setMaxStepCompleted(1);
    clearSelectedVehicleSelection({
      clearVehicleOptions: true,
    });
    setStatusMessage("Update your dates and continue through vehicle selection.");
  }

  function handleChangeVehicle() {
    resetMessages();
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

    const defaultPickupDate = dateInputForOffset(0);
    const defaultDropoffDate = dateInputForOffset(2);
    initialPickupDateRef.current = defaultPickupDate;
    initialDropoffDateRef.current = defaultDropoffDate;
    const defaultPickupLocation = locationOptions.find((location) => location.allowPickup)?.id ?? "";
    const defaultDropoffLocation =
      locationOptions.find((location) => location.allowDropoff)?.id ?? defaultPickupLocation;

    setStep(1);
    setMaxStepCompleted(1);
    setPickupDate(defaultPickupDate);
    setPickupTime("11:00");
    setDropoffDate(defaultDropoffDate);
    setDropoffTime("11:00");
    setPickupLocationId(defaultPickupLocation);
    setDropoffLocationId(defaultDropoffLocation);
    setPickupCustomAddress("");
    setDropoffCustomAddress("");

    setSelectedVehicleId("");
    setVehicleSelectionUnavailable(false);
    setVehicleOptions([]);
    setInsuranceSelected(false);
    setInsuranceEnabled(false);
    setInsurancePlanId(null);
    setInsurancePricePerDay(0);
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
    setDriversLicenseImageUrl("");
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
    setReturningBirthday("");
    setReturningBusy(false);
    setSubmitting(false);
    setErrorMessage(null);
    setStatusMessage("Booking draft cleared. Start again with dates and vehicle selection.");
    router.replace("/book");
  }

  async function uploadDriversLicenseFile(file: File) {
    setErrorMessage(null);
    setDriversLicenseUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
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
      });
      setDriversLicenseImageUrl(dataUrl);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to upload driver's license image.",
      );
    } finally {
      setDriversLicenseUploading(false);
    }
  }

  async function onDriversLicenseFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await uploadDriversLicenseFile(file);
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
          birthday: returningBirthday,
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
          pickupLocation: pickupLocationText,
          dropoffLocation: dropoffLocationText,
          pickupLocationId: pickupLocationId === CUSTOM_PICKUP_ID ? null : pickupLocationId,
          dropoffLocationId: dropoffLocationId === CUSTOM_DROPOFF_ID ? null : dropoffLocationId,
          pickupTime,
          dropoffTime,
          pickupLocationTextSnapshot: pickupLocationText,
          dropoffLocationTextSnapshot: dropoffLocationText,
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
          legalIdImageUploadToken: driversLicenseImageUrl,
          driversLicenseDataUrl: driversLicenseImageUrl,
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
      ? "If no payment is made, you are not entitled to the vehicle until the minimum deposit is paid."
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
    hasSelectedVehicleId && !pricingQuote
      ? pricingQuoteLoading || pricingQuoteUpdating
        ? "Refreshing live pricing…"
        : pricingState.status === "error"
          ? "Live pricing could not be loaded. Return to Step 2 and reselect your vehicle."
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
  const bookingIntro = (
    <PublicPageIntro
      eyebrow="Book"
      title="Reserve your Curated vehicle with guided steps and clear pricing."
      description="Choose your dates, review the right vehicle, confirm your details, and continue to secure checkout when you are ready."
      primaryAction={{ href: "/fleet", label: "Browse Fleet" }}
      secondaryAction={{ href: "/contact", label: "Need Help?" }}
    >
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
            Questions before checkout? Reach the Kingston team at {siteContent.phones[0]?.label}.
          </p>
        </article>
        <article className="rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
            Secure checkout
          </p>
          <p className="mt-3 text-sm leading-6 text-white/76">
            Reservation details are reviewed in six steps before Step 7 launches WiPay.
          </p>
        </article>
      </div>
    </PublicPageIntro>
  );

  if (!hydrated) {
    return (
      <div className="bg-[var(--ccr-bg)] pb-16" data-testid="booking-draft-loading">
        {bookingIntro}
        <Container className="-mt-8 md:-mt-12">
          <div className="rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/95 p-8 shadow-[0_28px_90px_rgba(15,23,42,0.12)] backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
              Restoring draft
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ccr-text)]">
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
    <div className="bg-[var(--ccr-bg)] pb-16" data-testid="booking-wizard-hydrated">
      {bookingIntro}
      <Container className="-mt-8 md:-mt-12">
        <div className="overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/96 shadow-[0_32px_110px_rgba(15,23,42,0.14)] backdrop-blur-sm">
          <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/75 px-4 py-6 md:px-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                  Guided reservation
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ccr-text)] md:text-4xl">
                  Complete six steps before secure checkout.
                </h2>
                <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)]">
                  Keep your selections accurate as dates, availability, pricing, and payment details
                  update in real time.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
                <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                    Pickup window
                  </p>
                  <p className="mt-3 text-sm font-semibold text-[var(--ccr-text)]">
                    {pickupDate} at {pickupTime}
                  </p>
                </article>
                <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                    Vehicle status
                  </p>
                  <p className="mt-3 text-sm font-semibold text-[var(--ccr-text)]">
                    {summaryVehicleLabel}
                  </p>
                </article>
                <article className="rounded-[1.35rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-accent-strong)]">
                    Reserve now
                  </p>
                  <p className="mt-3 text-sm font-semibold text-[var(--ccr-text)]">
                    {hideFallbackTotals ? "Pricing updating" : formatJmd(depositRequired)}
                  </p>
                </article>
              </div>
            </div>

            <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {STEPS.map((item) => {
                const isActive = item.step === step;
                const isDone = item.step < step;
                const isUnlocked = item.step <= maxStepCompleted;
                return (
                  <li key={item.step}>
                    <button
                      type="button"
                      onClick={() => jumpToStep(item.step)}
                      disabled={!isUnlocked || submitting}
                      className={cn(
                        "w-full rounded-[1.35rem] border px-4 py-3 text-left transition disabled:opacity-55",
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
                      <p className="mt-2 text-sm font-semibold">{item.title}</p>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setStep(6);
                    setStatusMessage("Step 7 launches when you continue from Payments.");
                  }}
                  disabled={maxStepCompleted < 6 || submitting}
                  className={cn(
                    "w-full rounded-[1.35rem] border px-4 py-3 text-left transition disabled:opacity-55",
                    maxStepCompleted >= 6
                      ? "border-[var(--ccr-accent)]/40 bg-[var(--ccr-accent)]/5 text-[var(--ccr-text)]"
                      : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]/90 text-[var(--ccr-muted)]",
                  )}
                  data-testid="booking-step-tab-7"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Step {CHECKOUT_STEP.step}
                  </p>
                  <p className="mt-2 text-sm font-semibold">{CHECKOUT_STEP.title}</p>
                </button>
              </li>
            </ol>
          </div>

          <div className="grid gap-6 bg-[linear-gradient(180deg,rgba(148,163,184,0.06),transparent)] px-4 py-6 md:px-6 md:py-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)]/96 px-4 py-6 shadow-[0_18px_56px_rgba(15,23,42,0.08)] md:px-6 md:py-7">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ccr-border)] pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent-strong)]">
                    Step {step} of 6
                  </p>
                  <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                    Review each section carefully. Live availability and pricing stay connected while you move through the wizard.
                  </p>
                </div>
                <div className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ccr-muted)]">
                  Secure booking flow
                </div>
              </div>
              {step === 1 ? (
                <section data-testid="booking-step-dates">
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Date & Time</h2>
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
                        onChange={(event) => {
                          const nextPickupDate = event.target.value;
                          setPickupDate(nextPickupDate);
                          setDropoffDate(addDaysToDateInput(nextPickupDate, 2));
                        }}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pickup Time</span>
                      <input
                        type="time"
                        value={pickupTime}
                        onChange={(event) => setPickupTime(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Date</span>
                      <input
                        type="date"
                        value={dropoffDate}
                        min={pickupDate}
                        onChange={(event) => setDropoffDate(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Time</span>
                      <input
                        type="time"
                        value={dropoffTime}
                        onChange={(event) => setDropoffTime(event.target.value)}
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pickup Location</span>
                      <select
                        value={pickupLocationId}
                        onChange={(event) => setPickupLocationId(event.target.value)}
                        disabled={locationsLoading}
                        className={bookingSoftFieldClassName}
                      >
                        {pickupOptions.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Location</span>
                      <select
                        value={dropoffLocationId}
                        onChange={(event) => setDropoffLocationId(event.target.value)}
                        disabled={locationsLoading}
                        className={bookingSoftFieldClassName}
                      >
                        {dropoffOptions.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {pickupLocationId === CUSTOM_PICKUP_ID ? (
                    <label className="mt-4 block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pick up Address</span>
                      <input
                        value={pickupCustomAddress}
                        onChange={(event) => setPickupCustomAddress(event.target.value)}
                        placeholder="Enter your pickup address"
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                  ) : null}
                  {dropoffLocationId === CUSTOM_DROPOFF_ID ? (
                    <label className="mt-4 block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Return Address</span>
                      <input
                        value={dropoffCustomAddress}
                        onChange={(event) => setDropoffCustomAddress(event.target.value)}
                        placeholder="Enter your return address"
                        className={bookingSoftFieldClassName}
                      />
                    </label>
                  ) : null}
                </section>
              ) : null}

              {step === 2 ? (
                <section data-testid="booking-step-vehicles">
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Available Vehicles</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Choose a vehicle for your dates. Details are pulled from your admin fleet setup.
                  </p>
                  {unavailableVehicleWarning ? (
                    <div className="mt-4 rounded-xl border border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] px-4 py-3 text-sm text-[var(--ccr-clerk-danger-text)]">
                      {unavailableVehicleWarning}
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

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
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
                <section>
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Protections & Coverage</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Insurance can only be selected after choosing a vehicle.
                  </p>

                  <div className="mt-5 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-[var(--ccr-text)]">
                          Full Coverage Insurance Plan
                        </p>
                        <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                          {formatJmd(insurancePricePerDay)} per day
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ccr-muted)]">
                        <input
                          type="checkbox"
                          checked={insuranceSelected}
                          disabled={!selectedVehicleId || !insuranceEnabled || insuranceLoading}
                          onChange={(event) => setInsuranceSelected(event.target.checked)}
                          className="h-4 w-4 rounded border-[var(--ccr-border)]"
                        />
                        Add plan
                      </label>
                    </div>
                    {!selectedVehicleId ? (
                      <p className="mt-3 text-sm text-amber-700">
                        Select a vehicle first to enable insurance options.
                      </p>
                    ) : null}
                    {selectedVehicleId && insuranceLoading ? (
                      <p className="mt-3 text-sm text-[var(--ccr-muted)]">Checking insurance plan…</p>
                    ) : null}
                    {selectedVehicleId && !insuranceLoading && !insuranceEnabled ? (
                      <p className="mt-3 text-sm text-[var(--ccr-muted)]">
                        Full Coverage Insurance Plan is currently unavailable for this vehicle.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
                    <p className="text-sm font-semibold text-[var(--ccr-text)]">Coupon Code</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        value={couponCode}
                        onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                        placeholder="Enter coupon code"
                        className="min-w-[220px] flex-1 rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={applyCoupon}
                        disabled={couponBusy}
                        className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-[var(--ccr-on-primary)] disabled:opacity-60"
                      >
                        {couponBusy ? "Applying..." : "Apply"}
                      </button>
                      {couponAppliedCode ? (
                        <button
                          type="button"
                          onClick={clearCoupon}
                          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
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
                </section>
              ) : null}

              {step === 4 ? (
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-[var(--ccr-text)]">Customer Information</h2>
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
                      className="rounded-xl border border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
                    >
                      Returning Customer?
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                    Enter your Driver&apos;s License number to prefill your details.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">First Name *</span>
                      <input
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Last Name *</span>
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Email Address *</span>
                      <input
                        type="email"
                        value={emailAddress}
                        onChange={(event) => setEmailAddress(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Phone Number *</span>
                      <input
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Street</span>
                      <input
                        value={street}
                        onChange={(event) => setStreet(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Street 2</span>
                      <input
                        value={street2}
                        onChange={(event) => setStreet2(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">City</span>
                      <input
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
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
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Country</span>
                      <input
                        value={country}
                        onChange={(event) => setCountry(event.target.value)}
                        placeholder="Jamaica"
                        className={bookingFieldClassName}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Birthday</span>
                      <input
                        type="date"
                        value={birthday}
                        onChange={(event) => setBirthday(event.target.value)}
                        className={bookingFieldClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                    <p className="text-base font-semibold text-[var(--ccr-text)]">
                      Driver&apos;s License
                    </p>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                      Driver&apos;s license details are optional.
                    </p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-semibold text-[var(--ccr-muted)]">DL Number</span>
                        <input
                          value={driversLicenseNumber}
                          onChange={(event) => setDriversLicenseNumber(event.target.value)}
                          className={bookingSoftFieldClassName}
                        />
                      </label>
                      <label className="block">
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
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={driversLicenseUploading}
                        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                      >
                        {driversLicenseUploading ? "Uploading..." : "Upload from phone/computer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={driversLicenseUploading}
                        className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                      >
                        Take photo
                      </button>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="image/*"
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
                    {driversLicenseImageUrl ? (
                      <p className="mt-2 text-sm text-emerald-700">
                        Driver&apos;s license image uploaded.
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
                        Optional: upload a driver&apos;s license image.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}

              {step === 5 ? (
                <section>
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Confirm Reservation</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Review your details, sign, and proceed to payment.
                  </p>

                  <div className="mt-5 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4 text-sm text-[var(--ccr-muted)]">
                    <p>
                      <span className="font-semibold text-[var(--ccr-text)]">Vehicle:</span>{" "}
                      {summaryVehicleLabel}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-[var(--ccr-text)]">Pickup:</span> {pickupDate}{" "}
                      {pickupTime} · {pickupLocationText}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-[var(--ccr-text)]">Dropoff:</span> {dropoffDate}{" "}
                      {dropoffTime} · {dropoffLocationText}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-[var(--ccr-text)]">Customer:</span> {firstName}{" "}
                      {lastName}
                    </p>
                  </div>

                  <div className="mt-5 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
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
                    <div className="mt-3 flex items-center gap-2">
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
                      className="mt-1 h-4 w-4 rounded border-[var(--ccr-border)]"
                    />
                    <span>
                      By clicking here, I confirm that I accept the privacy policy and terms.
                    </span>
                  </label>
                </section>
              ) : null}

              {step === 6 ? (
                <section data-testid="booking-step-payments">
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Payments</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Choose your payment option in JMD. Step 7 launches hosted WiPay checkout.
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

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setPaymentOption("DEPOSIT")}
                      className={cn(
                        "rounded-2xl border px-4 py-3 text-left",
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
                        "rounded-2xl border px-4 py-3 text-left",
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
                        "rounded-2xl border px-4 py-3 text-left",
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
                        "rounded-2xl border px-4 py-3 text-left",
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

                  <div
                    className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
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
                      className={bookingPrimaryButtonClassName}
                      data-testid="booking-continue-payment"
                    >
                      {submitting
                        ? "Submitting..."
                        : paymentOption === "NONE"
                          ? "Confirm Booking"
                          : "Continue to WiPay"}
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
                    "mt-4 rounded-[1.1rem] border px-4 py-3 text-sm",
                    statusIsDraftRestoreNotice
                      ? "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)] shadow-sm shadow-black/5"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800",
                  )}
                >
                  {statusMessage}
                </p>
              ) : null}

              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--ccr-border)] pt-6">
                <button
                  type="button"
                  onClick={() => setShowStartOverConfirm(true)}
                  disabled={submitting}
                  className={bookingResetButtonClassName}
                  data-testid="booking-start-over"
                >
                  Start over
                </button>
                <button
                  type="button"
                  onClick={moveToPreviousStep}
                  disabled={step === 1 || submitting}
                  className={bookingOutlineButtonClassName}
                >
                  Back
                </button>
                {step < 6 ? (
                  <button
                    type="button"
                    onClick={() => void moveToNextStep()}
                    disabled={submitting}
                    className={bookingPrimaryButtonClassName}
                  >
                    Next Step
                  </button>
                ) : null}
              </div>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="overflow-hidden rounded-[1.75rem] border border-[var(--ccr-border)] bg-[linear-gradient(160deg,var(--ccr-primary),rgba(15,23,42,0.96))] px-4 py-6 text-[var(--ccr-on-primary)] shadow-[0_28px_90px_rgba(15,23,42,0.2)] md:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
                Booking summary
              </p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight">Review before checkout</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--ccr-on-primary-muted)]">
                Use these controls to update your itinerary or change the vehicle before final payment.
              </p>
              <div className="mt-4 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 pr-1">
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
              <div className="mt-5 space-y-3 rounded-[1.35rem] border border-white/10 bg-white/6 p-4 text-sm shadow-inner shadow-black/10">
                <p>
                  <span className="text-[var(--ccr-on-primary-muted)]">Pickup:</span> {pickupDate} {pickupTime}
                </p>
                <p>
                  <span className="text-[var(--ccr-on-primary-muted)]">Dropoff:</span> {dropoffDate} {dropoffTime}
                </p>
                <p>
                  <span className="text-[var(--ccr-on-primary-muted)]">Pickup Location:</span>{" "}
                  {pickupLocationText || "Not selected"}
                </p>
                <p>
                  <span className="text-[var(--ccr-on-primary-muted)]">Dropoff Location:</span>{" "}
                  {dropoffLocationText || "Not selected"}
                </p>
                <p>
                  <span className="text-[var(--ccr-on-primary-muted)]">Vehicle:</span>{" "}
                  {summaryVehicleLabel}
                </p>
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
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
                    <div className="flex items-center justify-between">
                      <span>Days</span>
                      <span className="font-semibold">{hideFallbackTotals ? "—" : rentalDays}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Base rental</span>
                      <span className="font-semibold">{hideFallbackTotals ? "—" : formatJmd(baseTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Insurance</span>
                      <span className="font-semibold">{hideFallbackTotals ? "—" : formatJmd(insuranceTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Coupon</span>
                      <span className="font-semibold">{hideFallbackTotals ? "—" : `-${formatJmd(discountTotal)}`}</span>
                    </div>
                    <div className="my-2 h-px bg-[var(--ccr-border)]" />
                    <div className="flex items-center justify-between text-base">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold">{hideFallbackTotals ? "—" : formatJmd(amountDue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Amount Required to Reserve</span>
                      <span className="font-semibold">{hideFallbackTotals ? "—" : formatJmd(depositRequired)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Balance Due on Pickup</span>
                      <span className="font-semibold">{hideFallbackTotals ? "—" : formatJmd(balanceDueOnPickup)}</span>
                    </div>
                  </div>
                )}
                {pricingQuoteError ? (
                  <p className="mt-3 text-xs text-amber-200">{pricingQuoteError}</p>
                ) : null}
              </div>
              <div className="mt-6 rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ccr-accent)]">
                  Need assistance?
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--ccr-on-primary-muted)]">
                  Contact the Curated Car Rentals team at {siteContent.phones[0]?.label} if you need help before checkout.
                </p>
              </div>
              </div>
            </aside>
          </div>
        </div>
      </Container>

      {showReturningCustomerModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ccr-primary)]/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
            <h4 className="text-lg font-bold text-[var(--ccr-text)]">Returning Customer</h4>
            <p className="mt-1 text-sm text-[var(--ccr-muted)]">
              Verify with your Driver&apos;s License number before prefilling details.
            </p>

            {returningStage === "lookup" ? (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Driver&apos;s License Number</span>
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
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Driver&apos;s License Number</span>
                  <input
                    value={returningDlInput}
                    readOnly
                    className={bookingReadonlyFieldClassName}
                  />
                </label>
                <p className="text-xs text-[var(--ccr-muted)]">
                  If you have an email on file, enter the code we sent. Otherwise verify with last
                  name and date of birth.
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
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Birthday</span>
                  <input
                    type="date"
                    value={returningBirthday}
                    onChange={(event) => setReturningBirthday(event.target.value)}
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
            className="w-full max-w-md rounded-[1.75rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-[0_28px_90px_rgba(15,23,42,0.22)]"
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
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowStartOverConfirm(false)}
                className={bookingOutlineButtonClassName}
                data-testid="booking-start-over-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartOver}
                className={bookingResetButtonClassName}
                data-testid="booking-start-over-confirm"
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
