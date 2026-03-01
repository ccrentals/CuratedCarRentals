import assert from "node:assert/strict";
import test from "node:test";

import {
  createPricingLifecycleState,
  displayPricingSnapshot,
  draftRestoreSecurityState,
  restoreSelectionFieldsFromDraft,
  startPricingLifecycleRefresh,
  resolvePricingLifecycleSuccess,
  type WizardSelectionFields,
} from "@/lib/bookings/publicBookingWizardState";

test("draft restore keeps vehicle, dates, locations, insurance, and payment option", () => {
  const fallback: WizardSelectionFields = {
    pickupDate: "2099-01-01",
    pickupTime: "11:00",
    dropoffDate: "2099-01-04",
    dropoffTime: "11:00",
    pickupLocationId: "L1",
    dropoffLocationId: "L1",
    selectedVehicleId: "",
    insuranceSelected: false,
    paymentOption: "DEPOSIT",
  };

  const restored = restoreSelectionFieldsFromDraft(
    {
      pickupDate: "2099-02-10",
      pickupTime: "10:30",
      dropoffDate: "2099-02-14",
      dropoffTime: "09:45",
      pickupLocationId: "PICKUP-A",
      dropoffLocationId: "DROP-B",
      selectedVehicleId: "vehicle-xyz",
      insuranceSelected: true,
      paymentOption: "FULL",
    },
    fallback,
  );

  assert.equal(restored.pickupDate, "2099-02-10");
  assert.equal(restored.pickupTime, "10:30");
  assert.equal(restored.dropoffDate, "2099-02-14");
  assert.equal(restored.dropoffTime, "09:45");
  assert.equal(restored.pickupLocationId, "PICKUP-A");
  assert.equal(restored.dropoffLocationId, "DROP-B");
  assert.equal(restored.selectedVehicleId, "vehicle-xyz");
  assert.equal(restored.insuranceSelected, true);
  assert.equal(restored.paymentOption, "FULL");
});

test("draft restore security state keeps license upload optional and re-requires signature", () => {
  const security = draftRestoreSecurityState();

  assert.equal(security.requiresDriversLicenseUpload, false);
  assert.equal(security.requiresSignatureUpload, true);
  assert.equal(security.driversLicenseImageUrl, "");
  assert.equal(security.signatureDataUrl, "");
  assert.match(security.notice, /Draft restored\./i);
});

test("pricing refresh keeps last good snapshot and avoids fallback-to-zero behavior", () => {
  const ready = resolvePricingLifecycleSuccess({ total: 45000, depositRequired: 10000 });
  const loading = startPricingLifecycleRefresh(ready);

  assert.equal(loading.status, "loading");
  assert.deepEqual(loading.lastGood, { total: 45000, depositRequired: 10000 });
  assert.deepEqual(displayPricingSnapshot(loading), { total: 45000, depositRequired: 10000 });

  const initial = createPricingLifecycleState<{ total: number }>();
  assert.equal(displayPricingSnapshot(initial), null);
});
