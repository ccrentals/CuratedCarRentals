"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";

import { calcDaysInclusive } from "@/lib/payments/dateMath";
import { formatJmd } from "@/lib/money";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

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
  daily_rate_cents: number;
  deposit_cents: number;
  images?: string[];
  category?: string;
  seats?: number;
  transmission?: string;
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
    state?: string | null;
    zip?: string | null;
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

type PaymentStartResponse = {
  ok?: boolean;
  error?: string;
  redirectUrl?: string;
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
  zip?: string;
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

const CUSTOM_PICKUP_ID = "__CUSTOM_PICKUP__";
const CUSTOM_DROPOFF_ID = "__CUSTOM_DROPOFF__";
const WIZARD_DRAFT_STORAGE_KEY = "ccr_booking_wizard_draft_v1";

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

export function PublicBookingWizard() {
  const router = useRouter();
  const [requestedVehicleFromQuery, setRequestedVehicleFromQuery] = useState("");
  const draftHydratedRef = useRef(false);
  const preselectedVehicleIdRef = useRef("");

  const [step, setStep] = useState<WizardStep>(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pickupDate, setPickupDate] = useState(() => dateInputForOffset(0));
  const [pickupTime, setPickupTime] = useState("11:00");
  const [dropoffDate, setDropoffDate] = useState(() => dateInputForOffset(3));
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

  const [insuranceSelected, setInsuranceSelected] = useState(false);
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [insurancePlanId, setInsurancePlanId] = useState<string | null>(null);
  const [insurancePricePerDay, setInsurancePricePerDay] = useState(0);
  const [insuranceLoading, setInsuranceLoading] = useState(false);

  const [couponCode, setCouponCode] = useState("");
  const [couponAppliedCode, setCouponAppliedCode] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponBusy, setCouponBusy] = useState(false);
  const [pricingQuote, setPricingQuote] = useState<PricingQuoteSummary | null>(null);
  const [pricingQuoteLoading, setPricingQuoteLoading] = useState(false);
  const [pricingQuoteUpdating, setPricingQuoteUpdating] = useState(false);
  const [pricingQuoteError, setPricingQuoteError] = useState<string | null>(null);
  const pricingQuoteRequestRef = useRef(0);
  const pricingQuoteValueRef = useRef<PricingQuoteSummary | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [street, setStreet] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("Jamaica");
  const [birthday, setBirthday] = useState("");

  const [driversLicenseNumber, setDriversLicenseNumber] = useState("");
  const [driversLicenseExpirationDate, setDriversLicenseExpirationDate] = useState("");
  const [driversLicenseImageUrl, setDriversLicenseImageUrl] = useState("");
  const [driversLicenseUploading, setDriversLicenseUploading] = useState(false);
  const uploadcarePublicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";
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

  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = useRef(false);
  const signatureDirtyRef = useRef(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [paymentOption, setPaymentOption] = useState<"FULL" | "DEPOSIT" | "CUSTOM" | "NONE">(
    "DEPOSIT",
  );
  const [customPaymentAmount, setCustomPaymentAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    pricingQuoteValueRef.current = pricingQuote;
  }, [pricingQuote]);

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
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
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

      setStep(parseWizardStep(draft.step));
      if (typeof draft.pickupDate === "string") setPickupDate(draft.pickupDate);
      if (typeof draft.pickupTime === "string") setPickupTime(draft.pickupTime);
      if (typeof draft.dropoffDate === "string") setDropoffDate(draft.dropoffDate);
      if (typeof draft.dropoffTime === "string") setDropoffTime(draft.dropoffTime);
      if (typeof draft.pickupLocationId === "string") setPickupLocationId(draft.pickupLocationId);
      if (typeof draft.dropoffLocationId === "string") setDropoffLocationId(draft.dropoffLocationId);
      if (typeof draft.pickupCustomAddress === "string") setPickupCustomAddress(draft.pickupCustomAddress);
      if (typeof draft.dropoffCustomAddress === "string") setDropoffCustomAddress(draft.dropoffCustomAddress);
      if (typeof draft.selectedVehicleId === "string") setSelectedVehicleId(draft.selectedVehicleId);
      if (typeof draft.insuranceSelected === "boolean") setInsuranceSelected(draft.insuranceSelected);
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
      if (typeof draft.state === "string") setState(draft.state);
      if (typeof draft.zip === "string") setZip(draft.zip);
      if (typeof draft.country === "string") setCountry(draft.country);
      if (typeof draft.birthday === "string") setBirthday(draft.birthday);
      if (typeof draft.driversLicenseNumber === "string") setDriversLicenseNumber(draft.driversLicenseNumber);
      if (typeof draft.driversLicenseExpirationDate === "string") {
        setDriversLicenseExpirationDate(draft.driversLicenseExpirationDate);
      }
      if (typeof draft.customerId === "string" || draft.customerId === null) {
        setCustomerId(draft.customerId ?? null);
      }
      if (
        draft.paymentOption === "FULL" ||
        draft.paymentOption === "DEPOSIT" ||
        draft.paymentOption === "CUSTOM" ||
        draft.paymentOption === "NONE"
      ) {
        setPaymentOption(draft.paymentOption);
      }
      if (typeof draft.customPaymentAmount === "string") setCustomPaymentAmount(draft.customPaymentAmount);
      if (typeof draft.acceptTerms === "boolean") setAcceptTerms(draft.acceptTerms);

      // For security, DL uploads and signatures are never restored from browser storage.
      setDriversLicenseImageUrl("");
      setSignatureDataUrl("");
      setStatusMessage(
        "Draft restored. For security, please re-upload your driver's license image and signature.",
      );
    } catch {
      // Ignore invalid draft payloads.
    } finally {
      draftHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !draftHydratedRef.current) return;

    const draft: BookingWizardDraft = {
      step,
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
      state,
      zip,
      country,
      birthday,
      driversLicenseNumber,
      driversLicenseExpirationDate,
      customerId,
      paymentOption,
      customPaymentAmount,
      acceptTerms,
    };
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
    phoneNumber,
    pickupCustomAddress,
    pickupDate,
    pickupLocationId,
    pickupTime,
    selectedVehicleId,
    state,
    step,
    street,
    street2,
    zip,
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

  const loadAvailableVehicles = useCallback(async () => {
    if (!pickupDate || !dropoffDate || !datesValid) {
      setVehicleOptions([]);
      setSelectedVehicleId("");
      return [];
    }

    const response = await fetch(
      `/api/public/vehicles?pickupDate=${encodeURIComponent(
        pickupDate,
      )}&pickupTime=${encodeURIComponent(pickupTime)}&dropoffDate=${encodeURIComponent(
        dropoffDate,
      )}&dropoffTime=${encodeURIComponent(dropoffTime)}`,
      { cache: "no-store" },
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
        daily_rate_cents:
          typeof vehicle.daily_rate_cents === "number" ? vehicle.daily_rate_cents : 0,
        deposit_cents: typeof vehicle.deposit_cents === "number" ? vehicle.deposit_cents : 0,
        images: Array.isArray(vehicle.images)
          ? vehicle.images.filter((image): image is string => typeof image === "string")
          : [],
        category: typeof vehicle.category === "string" ? vehicle.category : "",
        seats: typeof vehicle.seats === "number" ? vehicle.seats : 0,
        transmission:
          typeof vehicle.transmission === "string" ? vehicle.transmission : "",
      }));

    let nextSelectedVehicleId = mapped.some((vehicle) => vehicle.id === selectedVehicleId)
      ? selectedVehicleId
      : "";

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

    setVehicleOptions(mapped);
    setSelectedVehicleId(nextSelectedVehicleId);
    return mapped;
  }, [datesValid, dropoffDate, dropoffTime, pickupDate, pickupTime, selectedVehicleId]);

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
      if (!selectedVehicleId) {
        setInsuranceEnabled(false);
        setInsurancePlanId(null);
        setInsurancePricePerDay(0);
        setInsuranceSelected(false);
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
  }, [selectedVehicleId]);

  useEffect(() => {
    if (!selectedVehicleId || !datesValid) {
      setPricingQuote(null);
      setPricingQuoteError(null);
      setPricingQuoteLoading(false);
      setPricingQuoteUpdating(false);
      return;
    }

    const pickup = combineDateTime(pickupDate, pickupTime);
    const dropoff = combineDateTime(dropoffDate, dropoffTime);
    if (!pickup || !dropoff) {
      setPricingQuote(null);
      setPricingQuoteError(null);
      setPricingQuoteLoading(false);
      setPricingQuoteUpdating(false);
      return;
    }

    const requestId = pricingQuoteRequestRef.current + 1;
    pricingQuoteRequestRef.current = requestId;
    const hasExistingQuote = pricingQuoteValueRef.current !== null;

    const timer = window.setTimeout(async () => {
      if (hasExistingQuote) {
        setPricingQuoteUpdating(true);
      } else {
        setPricingQuoteLoading(true);
      }
      setPricingQuoteError(null);
      try {
        const response = await fetch("/api/public/pricing/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: selectedVehicleId,
            startAt: pickup.toISOString(),
            endAt: dropoff.toISOString(),
            insuranceSelected: insuranceEnabled && insuranceSelected,
            promoCode: couponAppliedCode,
            paymentOption,
            customAmount: paymentOption === "CUSTOM" ? customPaymentAmount : undefined,
            customerEmail: normalizeText(emailAddress),
          }),
        });
        const data = (await response.json().catch(() => ({}))) as PricingQuoteResponse;
        if (requestId !== pricingQuoteRequestRef.current) return;
        if (!response.ok || !data.ok || !data.summary) {
          throw new Error(data.error ?? "Unable to refresh pricing.");
        }
        setPricingQuote(data.summary);
      } catch {
        if (requestId !== pricingQuoteRequestRef.current) return;
        setPricingQuoteError(
          "Live pricing quote is temporarily unavailable. Totals will be revalidated before payment.",
        );
      } finally {
        if (requestId !== pricingQuoteRequestRef.current) return;
        setPricingQuoteLoading(false);
        setPricingQuoteUpdating(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [
    couponAppliedCode,
    customPaymentAmount,
    datesValid,
    dropoffDate,
    dropoffTime,
    emailAddress,
    insuranceEnabled,
    insuranceSelected,
    paymentOption,
    pickupDate,
    pickupTime,
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
            insurancePricePerDayCents: insurancePricePerDay,
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
    insurancePricePerDay,
    insuranceSelected,
    pickupDate,
    selectedVehicleId,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!pickupDate || !dropoffDate || !datesValid) {
      setVehicleOptions([]);
      setSelectedVehicleId("");
      return () => {
        cancelled = true;
      };
    }

    async function loadVehicles() {
      setVehicleLoading(true);
      try {
        await loadAvailableVehicles();
      } catch {
        if (cancelled) return;
        setVehicleOptions([]);
        setSelectedVehicleId("");
      } finally {
        if (!cancelled) setVehicleLoading(false);
      }
    }

    void loadVehicles();

    return () => {
      cancelled = true;
    };
  }, [datesValid, dropoffDate, loadAvailableVehicles, pickupDate]);

  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    const textColor =
      getComputedStyle(document.documentElement).getPropertyValue("--ccr-text").trim() || "#0f172a";
    context.strokeStyle = textColor;
    context.lineWidth = 2;
  }, []);

  function resetMessages() {
    setErrorMessage(null);
    setStatusMessage(null);
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
      if (!selectedVehicleId) {
        setErrorMessage("Select a vehicle to continue.");
        return false;
      }
    }

    if (stepToValidate === 4) {
      if (!normalizeText(firstName) || !normalizeText(lastName)) {
        setErrorMessage("First name and last name are required.");
        return false;
      }
      if (!normalizeText(driversLicenseNumber)) {
        setErrorMessage("Driver's license number is required.");
        return false;
      }
      if (!driversLicenseImageUrl) {
        setErrorMessage("Driver's license image upload is required.");
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
      if (!selectedVehicleId) {
        setErrorMessage("Vehicle selection is required.");
        return false;
      }
      if (!driversLicenseImageUrl || !normalizeText(driversLicenseNumber)) {
        setErrorMessage("Driver's license number and image are required.");
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
      const availableVehicles = await loadAvailableVehicles();
      const stillAvailable = availableVehicles.some((vehicle) => vehicle.id === vehicleId);
      if (!stillAvailable) {
        setSelectedVehicleId("");
        setErrorMessage(
          "The selected vehicle is no longer available for this date/time range. Please reselect a vehicle.",
        );
        return false;
      }
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
      setStatusMessage("Vehicle selected and availability confirmed.");
    }
    setVehicleLoading(false);
  }

  async function moveToNextStep() {
    if (!verifyStep(step)) return;
    if (step === 2 && selectedVehicleId) {
      setVehicleLoading(true);
      const available = await revalidateSelectedVehicleAvailability(selectedVehicleId);
      setVehicleLoading(false);
      if (!available) return;
    }
    setStep((current) => (current < 6 ? ((current + 1) as WizardStep) : current));
  }

  function moveToPreviousStep() {
    resetMessages();
    setStep((current) => (current > 1 ? ((current - 1) as WizardStep) : current));
  }

  async function uploadDriversLicenseFile(file: File) {
    setErrorMessage(null);
    if (!uploadcarePublicKey.trim()) {
      setErrorMessage(
        "Driver's license upload is unavailable right now. Configure NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY.",
      );
      return;
    }

    setDriversLicenseUploading(true);
    try {
      const formData = new FormData();
      formData.set("UPLOADCARE_PUB_KEY", uploadcarePublicKey.trim());
      formData.set("UPLOADCARE_STORE", "1");
      formData.set("file", file);

      const response = await fetch("https://upload.uploadcare.com/base/", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | { file?: unknown; error?: { content?: unknown } }
        | null;

      if (!response.ok || typeof payload?.file !== "string") {
        throw new Error(
          typeof payload?.error?.content === "string"
            ? payload.error.content
            : "Unable to upload license image.",
        );
      }

      setDriversLicenseImageUrl(payload.file);
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
          insurancePricePerDayCents: insurancePricePerDay,
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

  function beginSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    signatureDrawingRef.current = true;
    signatureDirtyRef.current = true;
    context.beginPath();
    context.moveTo(x, y);
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!signatureDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    context.lineTo(x, y);
    context.stroke();
  }

  function endSignature() {
    if (!signatureDrawingRef.current) return;
    signatureDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (!canvas || !signatureDirtyRef.current) return;
    setSignatureDataUrl(canvas.toDataURL("image/png"));
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
    setReturningBusy(true);
    setReturningError(null);

    try {
      const response = await fetch("/api/public/returning-customer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driversLicenseNumber: returningDlInput,
          sessionKey: returningSessionKey,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ReturningStartResponse;

      if (!response.ok || !data.ok) {
        throw new Error("We couldn't verify your details.");
      }

      setReturningChallengeToken(data.challengeToken ?? "");
      setReturningStage("verify");
    } catch {
      setReturningError("We couldn't verify your details.");
    } finally {
      setReturningBusy(false);
    }
  }

  async function verifyReturningCustomer() {
    if (returningBusy) return;
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
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ReturningVerifyResponse;
      if (!response.ok || !data.ok || !data.customer) {
        throw new Error("We couldn't verify your details.");
      }

      setCustomerId(data.customer.customerId ?? null);
      setFirstName((current) => setIfPresent(current, data.customer?.firstName));
      setLastName((current) => setIfPresent(current, data.customer?.lastName));
      setEmailAddress((current) => setIfPresent(current, data.customer?.emailAddress));
      setPhoneNumber((current) => setIfPresent(current, data.customer?.phoneNumber));
      setStreet((current) => setIfPresent(current, data.customer?.street));
      setStreet2((current) => setIfPresent(current, data.customer?.street2));
      setCity((current) => setIfPresent(current, data.customer?.city));
      setState((current) => setIfPresent(current, data.customer?.state));
      setZip((current) => setIfPresent(current, data.customer?.zip));
      setCountry((current) => setIfPresent(current, data.customer?.country));
      setBirthday((current) => setIfPresent(current, data.customer?.birthday));
      setDriversLicenseNumber((current) =>
        setIfPresent(current, data.customer?.driversLicenseNumber),
      );

      setShowReturningCustomerModal(false);
      setStatusMessage("Returning customer details loaded. Please verify and continue.");
    } catch {
      setReturningError("We couldn't verify your details.");
    } finally {
      setReturningBusy(false);
    }
  }

  async function startWiPayFlow(
    bookingId: string,
    mode: "DEPOSIT" | "FULL" | "CUSTOM",
    customAmountCents?: number,
  ) {
    const csrfToken = await ensureCsrfToken();
    const endpoint =
      mode === "FULL"
        ? "/api/payments/wipay/full/start"
        : mode === "CUSTOM"
          ? "/api/payments/wipay/custom/start"
          : "/api/payments/wipay/start";

    const payload =
      mode === "CUSTOM"
        ? { bookingId, customAmountCents: Math.max(1, Math.round(customAmountCents ?? 0)) }
        : { bookingId };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as PaymentStartResponse;
    if (!response.ok || !data.redirectUrl) {
      throw new Error(data.error ?? "Unable to start payment.");
    }
    window.location.href = data.redirectUrl;
  }

  async function submitBooking() {
    if (submitting) return;
    if (!verifyStep(6)) return;

    setSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const fullName = `${normalizeText(firstName)} ${normalizeText(lastName)}`.trim();
      const fallbackEmail = `no-email+${Date.now()}@curated.local`;
      const fallbackPhone = "0000000";
      const normalizedCustomAmount =
        paymentOption === "CUSTOM" ? Math.max(1, Math.round(customPaymentNumber)) : null;

      const bookingResponse = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: selectedVehicleId,
          customerId,
          fullName,
          email: normalizeText(emailAddress) || fallbackEmail,
          phone: normalizeText(phoneNumber) || fallbackPhone,
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
          insurancePricePerDayCents:
            pricingQuote?.insurancePricePerDay ?? insurancePricePerDay,
          insuranceTotalCents: insuranceTotal,
          paymentOption,
          customPaymentAmountCents: normalizedCustomAmount,
          legalIdType: "DRIVERS_LICENSE",
          legalIdNumber: normalizeText(driversLicenseNumber),
          legalIdImageUploadToken: driversLicenseImageUrl,
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
            state: normalizeText(state) || null,
            zip: normalizeText(zip) || null,
            country: normalizeText(country) || null,
            birthday: normalizeText(birthday) || null,
          },
        }),
      });

      const bookingData = (await bookingResponse.json().catch(() => ({}))) as BookingCreateResponse;
      if (!bookingResponse.ok || !bookingData.bookingId) {
        throw new Error(bookingData.error ?? "Unable to create booking.");
      }

      const bookingId = bookingData.bookingId;
      if (bookingData.bookingAccessToken) {
        document.cookie = `ccr_booking_access_${bookingId}=${encodeURIComponent(
          bookingData.bookingAccessToken,
        )}; Path=/; Max-Age=2592000; SameSite=Lax`;
      }
      const csrfToken = await ensureCsrfToken();

      if (paymentOption === "NONE") {
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
        clearWizardDraft();
        await startWiPayFlow(bookingId, "FULL");
        return;
      }

      if (paymentOption === "DEPOSIT") {
        clearWizardDraft();
        await startWiPayFlow(bookingId, "DEPOSIT");
        return;
      }

      if (!normalizedCustomAmount) {
        throw new Error("Custom payment amount is required.");
      }
      clearWizardDraft();
      await startWiPayFlow(bookingId, "CUSTOM", normalizedCustomAmount);
    } catch (error) {
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

  return (
    <div className="min-h-screen bg-[var(--ccr-bg)] py-8 md:py-12">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-xl shadow-[var(--ccr-primary)]/10">
          <div className="bg-gradient-to-r from-[var(--ccr-primary)] to-[var(--ccr-primary-soft)] px-6 py-8 text-[var(--ccr-on-primary)] md:px-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ccr-on-primary-muted)]">
              Curated Car Rentals
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              Reservation Wizard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ccr-on-primary-muted)] md:text-base">
              Complete all six steps to reserve your vehicle. Availability is rechecked before
              confirmation.
            </p>
          </div>

          <div className="border-b border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-4 md:px-8">
            <ol className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {STEPS.map((item) => {
                const isActive = item.step === step;
                const isDone = item.step < step;
                return (
                  <li
                    key={item.step}
                    className={cn(
                      "rounded-2xl border px-3 py-2 text-center transition",
                      isActive
                        ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10 text-[var(--ccr-text)]"
                        : isDone
                          ? "border-[var(--ccr-accent)]/40 bg-[var(--ccr-accent)]/5 text-[var(--ccr-text)]"
                          : "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-muted)]",
                    )}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide">
                      Step {item.step}
                    </p>
                    <p className="mt-1 text-sm font-semibold">{item.title}</p>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="px-4 py-6 md:px-8 md:py-8">
              {step === 1 ? (
                <section>
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
                        onChange={(event) => setPickupDate(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Pickup Time</span>
                      <input
                        type="time"
                        value={pickupTime}
                        onChange={(event) => setPickupTime(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Date</span>
                      <input
                        type="date"
                        value={dropoffDate}
                        min={pickupDate}
                        onChange={(event) => setDropoffDate(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Dropoff Time</span>
                      <input
                        type="time"
                        value={dropoffTime}
                        onChange={(event) => setDropoffTime(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
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
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
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
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
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
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
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
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
                      />
                    </label>
                  ) : null}
                </section>
              ) : null}

              {step === 2 ? (
                <section>
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Available Vehicle Classes</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Choose one vehicle to continue. Selection is revalidated before confirmation.
                  </p>

                  {vehicleLoading ? <p className="mt-4 text-sm text-[var(--ccr-muted)]">Checking availability…</p> : null}

                  <div className="mt-5 space-y-4">
                    {vehicleOptions.map((vehicle) => {
                      const selected = vehicle.id === selectedVehicleId;
                      return (
                        <article
                          key={vehicle.id}
                          className={cn(
                            "rounded-2xl border p-4 transition",
                            selected ? "border-[var(--ccr-accent)] bg-[var(--ccr-accent)]/10" : "border-[var(--ccr-border)] bg-[var(--ccr-surface)]",
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-bold text-[var(--ccr-text)]">
                                {displayVehicleName(vehicle)}
                              </h3>
                              <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                                {vehicle.transmission || "Automatic"} · {vehicle.seats || 5} seats
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-[var(--ccr-muted)]">Per day</p>
                              <p className="text-lg font-bold text-[var(--ccr-text)]">
                                {formatJmd(vehicle.daily_rate_cents)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4">
                            <button
                              type="button"
                              onClick={() => void handleVehicleSelect(vehicle.id)}
                              disabled={vehicleLoading}
                              className={cn(
                                "rounded-xl px-4 py-2 text-sm font-semibold",
                                selected
                                  ? "bg-[var(--ccr-primary)] text-[var(--ccr-on-primary)]"
                                  : "border border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)]",
                              )}
                            >
                              {selected ? "Selected" : "Select Vehicle"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {!vehicleLoading && vehicleOptions.length === 0 ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Last Name *</span>
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Email Address</span>
                      <input
                        type="email"
                        value={emailAddress}
                        onChange={(event) => setEmailAddress(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Phone Number</span>
                      <input
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Street</span>
                      <input
                        value={street}
                        onChange={(event) => setStreet(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Street 2</span>
                      <input
                        value={street2}
                        onChange={(event) => setStreet2(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">City</span>
                      <input
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">State</span>
                      <input
                        value={state}
                        onChange={(event) => setState(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Zip</span>
                      <input
                        value={zip}
                        onChange={(event) => setZip(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Country</span>
                      <input
                        value={country}
                        onChange={(event) => setCountry(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--ccr-muted)]">Birthday</span>
                      <input
                        type="date"
                        value={birthday}
                        onChange={(event) => setBirthday(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
                    <p className="text-base font-semibold text-[var(--ccr-text)]">
                      Driver&apos;s License
                    </p>
                    <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                      Driver&apos;s license number and image are mandatory.
                    </p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-semibold text-[var(--ccr-muted)]">
                          DL Number *
                        </span>
                        <input
                          value={driversLicenseNumber}
                          onChange={(event) => setDriversLicenseNumber(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
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
                          className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm"
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
                      <p className="mt-2 text-sm text-rose-600">
                        Driver&apos;s license image is required.
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
                      {selectedVehicle ? displayVehicleName(selectedVehicle) : "Not selected"}
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
                    <canvas
                      ref={signatureCanvasRef}
                      className="mt-2 h-40 w-full touch-none rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
                      onPointerDown={beginSignature}
                      onPointerMove={drawSignature}
                      onPointerUp={endSignature}
                      onPointerLeave={endSignature}
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
                <section>
                  <h2 className="text-xl font-bold text-[var(--ccr-text)]">Payments</h2>
                  <p className="mt-1 text-sm text-[var(--ccr-muted)]">
                    Choose your payment option in JMD. WiPay is the final step for online payment.
                  </p>

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
                        className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                      />
                    </label>
                  ) : null}

                  {paymentWarning ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {paymentWarning}
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={submitBooking}
                      disabled={submitting || driversLicenseUploading}
                      className="rounded-xl bg-[var(--ccr-primary)] px-5 py-3 text-sm font-semibold text-[var(--ccr-on-primary)] disabled:opacity-60"
                    >
                      {submitting ? "Submitting..." : paymentOption === "NONE" ? "Confirm Reservation" : "Continue to Payment"}
                    </button>
                  </div>
                </section>
              ) : null}

              {errorMessage ? (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </p>
              ) : null}
              {statusMessage ? (
                <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {statusMessage}
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={moveToPreviousStep}
                  disabled={step === 1 || submitting}
                  className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] disabled:opacity-40"
                >
                  Back
                </button>
                {step < 6 ? (
                  <button
                    type="button"
                    onClick={() => void moveToNextStep()}
                    disabled={submitting}
                    className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-[var(--ccr-on-primary)] disabled:opacity-60"
                  >
                    Next Step
                  </button>
                ) : null}
              </div>
            </div>

            <aside className="border-t border-[var(--ccr-border)] bg-[var(--ccr-primary)] px-4 py-6 text-[var(--ccr-on-primary)] md:px-8 lg:border-l lg:border-t-0">
              <h3 className="text-xl font-bold">Summary</h3>
              <div className="mt-4 space-y-2 text-sm">
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
                  {selectedVehicle ? displayVehicleName(selectedVehicle) : "Not selected"}
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-primary-soft)]/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-on-primary-muted)]">Pricing (JMD)</p>
                {pricingQuoteLoading ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="animate-pulse text-[var(--ccr-on-primary-muted)]">Updating...</p>
                    <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--ccr-on-primary)]/20" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--ccr-on-primary)]/20" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--ccr-on-primary)]/20" />
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 text-sm">
                    {pricingQuoteUpdating ? (
                      <p className="text-xs text-[var(--ccr-on-primary-muted)]">Updating...</p>
                    ) : null}
                    <div className="flex items-center justify-between">
                      <span>Days</span>
                      <span className="font-semibold">{rentalDays}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Base rental</span>
                      <span className="font-semibold">{formatJmd(baseTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Insurance</span>
                      <span className="font-semibold">{formatJmd(insuranceTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Coupon</span>
                      <span className="font-semibold">-{formatJmd(discountTotal)}</span>
                    </div>
                    <div className="my-2 h-px bg-[var(--ccr-border)]" />
                    <div className="flex items-center justify-between text-base">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold">{formatJmd(amountDue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Amount Required to Reserve</span>
                      <span className="font-semibold">{formatJmd(depositRequired)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Balance Due on Pickup</span>
                      <span className="font-semibold">{formatJmd(balanceDueOnPickup)}</span>
                    </div>
                  </div>
                )}
                {pricingQuoteError ? (
                  <p className="mt-3 text-xs text-amber-200">{pricingQuoteError}</p>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </div>

      {showReturningCustomerModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ccr-primary)]/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-xl">
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
                    className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={startReturningCustomerLookup}
                  disabled={returningBusy}
                  className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-[var(--ccr-on-primary)] disabled:opacity-60"
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
                    className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-2 text-sm"
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
                    className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Last Name</span>
                  <input
                    value={returningLastName}
                    onChange={(event) => setReturningLastName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ccr-muted)]">Birthday</span>
                  <input
                    type="date"
                    value={returningBirthday}
                    onChange={(event) => setReturningBirthday(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={verifyReturningCustomer}
                  disabled={returningBusy}
                  className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-[var(--ccr-on-primary)] disabled:opacity-60"
                >
                  {returningBusy ? "Verifying..." : "Verify & Prefill"}
                </button>
              </div>
            )}

            {returningError ? <p className="mt-3 text-sm text-rose-600">{returningError}</p> : null}

            <button
              type="button"
              onClick={() => setShowReturningCustomerModal(false)}
              className="mt-4 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
