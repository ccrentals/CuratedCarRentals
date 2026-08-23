import fs from "node:fs";
import path from "node:path";

export const FIXTURES_PATH = path.join(process.cwd(), ".artifacts", "e2e-fixtures.json");

export type PromoFixtureRef = {
  id: string;
  publicId: string;
  code: string;
};

export type PaymentFixtureRef = {
  id: string;
  publicId: string;
  amountCents: number;
  provider: "MANUAL" | "WIPAY";
  status: "DEPOSIT_PAID" | "REFUNDED";
  paymentType: string | null;
};

export type BookingFixtureRef = {
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
    historicalProvider?: PaymentFixtureRef;
  };
};

export type E2EFixtures = {
  runId: string;
  createdAt: string;
  adminUser?: {
    id?: string | null;
    email?: string | null;
    createdBySeed?: boolean;
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
    refundableHistoricalPayment: BookingFixtureRef;
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

export function readE2EFixtures<T extends E2EFixtures = E2EFixtures>(
  validate?: (fixtures: T) => void,
): T {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(`Fixtures file not found: ${FIXTURES_PATH}. Run npm run e2e:seed first.`);
  }

  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  const fixtures = JSON.parse(raw) as T;
  if (!fixtures?.runId) {
    throw new Error("Fixtures file is missing the runId.");
  }
  validate?.(fixtures);
  return fixtures;
}

export function maybeReadE2EFixtures<T extends E2EFixtures = E2EFixtures>() {
  if (!fs.existsSync(FIXTURES_PATH)) return null;
  const raw = fs.readFileSync(FIXTURES_PATH, "utf8");
  return JSON.parse(raw) as T;
}
