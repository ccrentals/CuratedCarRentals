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

export type DraftRestoreSecurityState = {
  requiresDriversLicenseUpload: boolean;
  requiresSignatureUpload: boolean;
  driversLicenseImageUrl: "";
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

export const DRAFT_RESTORE_SECURITY_NOTICE =
  "Draft restored. For security, please re-upload your driver's license image and signature.";

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
): WizardSelectionFields {
  const paymentOption = parsePaymentOption(draft.paymentOption) ?? fallback.paymentOption;

  return {
    pickupDate: normalizeText(draft.pickupDate) || fallback.pickupDate,
    pickupTime: normalizeText(draft.pickupTime) || fallback.pickupTime,
    dropoffDate: normalizeText(draft.dropoffDate) || fallback.dropoffDate,
    dropoffTime: normalizeText(draft.dropoffTime) || fallback.dropoffTime,
    pickupLocationId: normalizeText(draft.pickupLocationId) || fallback.pickupLocationId,
    dropoffLocationId: normalizeText(draft.dropoffLocationId) || fallback.dropoffLocationId,
    selectedVehicleId: normalizeText(draft.selectedVehicleId) || fallback.selectedVehicleId,
    insuranceSelected:
      typeof draft.insuranceSelected === "boolean"
        ? draft.insuranceSelected
        : fallback.insuranceSelected,
    paymentOption,
  };
}

export function draftRestoreSecurityState(): DraftRestoreSecurityState {
  return {
    requiresDriversLicenseUpload: true,
    requiresSignatureUpload: true,
    driversLicenseImageUrl: "",
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
