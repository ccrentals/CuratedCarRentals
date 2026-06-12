export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type WizardPaymentOption = "FULL" | "DEPOSIT" | "CUSTOM" | "NONE";

export type WizardSelectionFields = {
  pickupDate: string;
  pickupTime: string;
  dropoffDate: string;
  dropoffTime: string;
  pickupLocationId: string;
  dropoffLocationId: string;
  selectedVehicleId: string;
  insuranceSelected: boolean;
  paymentOption: WizardPaymentOption;
};

export type DraftRestoreOptions = {
  selectedVehicleIdOverride?: string | null;
};

export type DraftRestoreSecurityState = {
  requiresDriversLicenseUpload: boolean;
  requiresSignatureUpload: boolean;
  driversLicenseImageUrls: string[];
  signatureDataUrl: "";
  notice: string;
};

export type PricingStatus = "idle" | "loading" | "ready" | "error";

export type PricingLifecycleState<T> = {
  status: PricingStatus;
  current: T | null;
  lastGood: T | null;
  error: string | null;
};

export type VehicleRefreshComparable = {
  id: string;
  name?: string;
  make?: string;
  model?: string;
  year?: number;
  daily_rate_cents?: number;
  deposit_cents?: number;
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

export type VehicleRefreshState<T extends VehicleRefreshComparable> = {
  vehicleOptions: T[];
  inventoryChanged: boolean;
  vehicleSelectionUnavailable: boolean;
  refreshWarning: string | null;
};

export const DRAFT_RESTORE_SECURITY_NOTICE =
  "Draft restored. For security, please re-sign your signature before continuing.";
export const VEHICLE_REFRESH_FAILURE_MESSAGE =
  "Live availability could not be refreshed. Showing the last confirmed vehicle list.";

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parsePaymentOption(value: unknown): WizardPaymentOption | null {
  if (value === "FULL" || value === "DEPOSIT" || value === "CUSTOM" || value === "NONE") {
    return value;
  }
  return null;
}

export function restoreSelectionFieldsFromDraft(
  draft: Record<string, unknown>,
  fallback: WizardSelectionFields,
  options: DraftRestoreOptions = {},
): WizardSelectionFields {
  const paymentOption = parsePaymentOption(draft.paymentOption) ?? fallback.paymentOption;
  const selectedVehicleIdOverride = normalizeText(options.selectedVehicleIdOverride);

  return {
    pickupDate: normalizeText(draft.pickupDate) || fallback.pickupDate,
    pickupTime: normalizeText(draft.pickupTime) || fallback.pickupTime,
    dropoffDate: normalizeText(draft.dropoffDate) || fallback.dropoffDate,
    dropoffTime: normalizeText(draft.dropoffTime) || fallback.dropoffTime,
    pickupLocationId: normalizeText(draft.pickupLocationId) || fallback.pickupLocationId,
    dropoffLocationId: normalizeText(draft.dropoffLocationId) || fallback.dropoffLocationId,
    selectedVehicleId:
      selectedVehicleIdOverride ||
      normalizeText(draft.selectedVehicleId) ||
      fallback.selectedVehicleId,
    insuranceSelected:
      typeof draft.insuranceSelected === "boolean"
        ? draft.insuranceSelected
        : fallback.insuranceSelected,
    paymentOption,
  };
}

export function draftRestoreSecurityState(): DraftRestoreSecurityState {
  return {
    requiresDriversLicenseUpload: false,
    requiresSignatureUpload: true,
    driversLicenseImageUrls: [],
    signatureDataUrl: "",
    notice: DRAFT_RESTORE_SECURITY_NOTICE,
  };
}

export function createPricingLifecycleState<T>(): PricingLifecycleState<T> {
  return {
    status: "idle",
    current: null,
    lastGood: null,
    error: null,
  };
}

export function startPricingLifecycleRefresh<T>(
  previous: PricingLifecycleState<T>,
): PricingLifecycleState<T> {
  return {
    status: "loading",
    current: previous.current,
    lastGood: previous.lastGood,
    error: null,
  };
}

export function resolvePricingLifecycleSuccess<T>(next: T): PricingLifecycleState<T> {
  return {
    status: "ready",
    current: next,
    lastGood: next,
    error: null,
  };
}

export function resolvePricingLifecycleError<T>(
  previous: PricingLifecycleState<T>,
  message: string,
): PricingLifecycleState<T> {
  return {
    status: "error",
    current: previous.current,
    lastGood: previous.lastGood,
    error: message,
  };
}

export function displayPricingSnapshot<T>(state: PricingLifecycleState<T>): T | null {
  return state.current ?? state.lastGood;
}

export function pricingIsLoadingWithoutSnapshot<T>(state: PricingLifecycleState<T>) {
  return state.status === "loading" && state.lastGood === null;
}

export function pricingIsUpdatingWithSnapshot<T>(state: PricingLifecycleState<T>) {
  return state.status === "loading" && state.lastGood !== null;
}

export function createVehicleRefreshSignature<T extends VehicleRefreshComparable>(vehicles: T[]) {
  return JSON.stringify(
    vehicles.map((vehicle) => ({
      id: normalizeText(vehicle.id),
      name: normalizeText(vehicle.name),
      make: normalizeText(vehicle.make),
      model: normalizeText(vehicle.model),
      year: Number(vehicle.year ?? 0),
      dailyRateCents: Number(vehicle.daily_rate_cents ?? 0),
      depositCents: Number(vehicle.deposit_cents ?? 0),
      images: Array.isArray(vehicle.images)
        ? vehicle.images
            .filter((value): value is string => typeof value === "string")
            .map((value) => normalizeText(value))
            .filter(Boolean)
        : [],
      category: normalizeText(vehicle.category),
      seats: Number(vehicle.seats ?? 0),
      doors: Number(vehicle.doors ?? 0),
      transmission: normalizeText(vehicle.transmission),
      bags: Number(vehicle.bags ?? 0),
      fuelPolicy: normalizeText(vehicle.fuelPolicy),
      mileagePolicy: normalizeText(vehicle.mileagePolicy),
      airConditioning: vehicle.airConditioning === true,
      hybrid: vehicle.hybrid === true,
      drivetrain: normalizeText(vehicle.drivetrain),
      description: normalizeText(vehicle.description),
    })),
  );
}

export function reconcileVehicleRefreshState<T extends VehicleRefreshComparable>(params: {
  previousVehicles: T[];
  nextVehicles: T[] | null;
  selectedVehicleId: string;
  failureMessage?: string | null;
}): VehicleRefreshState<T> {
  const selectedVehicleId = normalizeText(params.selectedVehicleId);
  const vehicleOptions = params.nextVehicles ?? params.previousVehicles;
  const inventoryChanged =
    params.nextVehicles === null
      ? false
      : createVehicleRefreshSignature(params.previousVehicles) !==
        createVehicleRefreshSignature(params.nextVehicles);

  return {
    vehicleOptions,
    inventoryChanged,
    vehicleSelectionUnavailable:
      selectedVehicleId.length > 0 && !vehicleOptions.some((vehicle) => normalizeText(vehicle.id) === selectedVehicleId),
    refreshWarning: params.nextVehicles === null ? params.failureMessage ?? null : null,
  };
}
