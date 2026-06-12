import assert from "node:assert/strict";
import test from "node:test";

import {
  createVehicleRefreshSignature,
  createPricingLifecycleState,
  displayPricingSnapshot,
  draftRestoreSecurityState,
  reconcileVehicleRefreshState,
  restoreSelectionFieldsFromDraft,
  VEHICLE_REFRESH_FAILURE_MESSAGE,
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

test("draft restore lets an explicit vehicle selection override a stale draft vehicle", () => {
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
      selectedVehicleId: "previous-vehicle",
      paymentOption: "DEPOSIT",
    },
    fallback,
    { selectedVehicleIdOverride: "new-query-vehicle" },
  );

  assert.equal(restored.selectedVehicleId, "new-query-vehicle");
});

test("draft restore keeps the draft vehicle when there is no explicit vehicle override", () => {
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
      selectedVehicleId: "previous-vehicle",
      paymentOption: "DEPOSIT",
    },
    fallback,
  );

  assert.equal(restored.selectedVehicleId, "previous-vehicle");
});

test("draft restore security state keeps license upload optional and re-requires signature", () => {
  const security = draftRestoreSecurityState();

  assert.equal(security.requiresDriversLicenseUpload, false);
  assert.equal(security.requiresSignatureUpload, true);
  assert.deepEqual(security.driversLicenseImageUrls, []);
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

test("vehicle refresh stays visually stable when the available inventory is unchanged", () => {
  const previousVehicles = [
    {
      id: "vehicle-1",
      name: "Subaru Impreza Sport",
      daily_rate_cents: 7200,
      deposit_cents: 7000,
      images: ["https://ucarecdn.com/a/"],
    },
    {
      id: "vehicle-2",
      name: "Nissan X-Trail",
      daily_rate_cents: 9800,
      deposit_cents: 10000,
      images: ["https://ucarecdn.com/b/"],
    },
  ];

  const nextVehicles = previousVehicles.map((vehicle) => ({ ...vehicle }));
  const result = reconcileVehicleRefreshState({
    previousVehicles,
    nextVehicles,
    selectedVehicleId: "vehicle-1",
  });

  assert.equal(createVehicleRefreshSignature(previousVehicles), createVehicleRefreshSignature(nextVehicles));
  assert.equal(result.inventoryChanged, false);
  assert.equal(result.vehicleSelectionUnavailable, false);
  assert.equal(result.refreshWarning, null);
});

test("vehicle refresh marks the selected vehicle unavailable while keeping remaining cars visible", () => {
  const previousVehicles = [
    { id: "vehicle-1", name: "2020 Daihatsu Mira ES" },
    { id: "vehicle-2", name: "BMW 530i" },
    { id: "vehicle-3", name: "Nissan X-Trail" },
  ];
  const nextVehicles = previousVehicles.slice(1);

  const result = reconcileVehicleRefreshState({
    previousVehicles,
    nextVehicles,
    selectedVehicleId: "vehicle-1",
  });

  assert.equal(result.inventoryChanged, true);
  assert.equal(result.vehicleSelectionUnavailable, true);
  assert.deepEqual(
    result.vehicleOptions.map((vehicle) => vehicle.id),
    ["vehicle-2", "vehicle-3"],
  );
});

test("vehicle refresh failure preserves the last good list and exposes a non-blocking warning", () => {
  const previousVehicles = [
    { id: "vehicle-2", name: "BMW 530i" },
    { id: "vehicle-3", name: "Nissan X-Trail" },
  ];

  const result = reconcileVehicleRefreshState({
    previousVehicles,
    nextVehicles: null,
    selectedVehicleId: "vehicle-2",
    failureMessage: VEHICLE_REFRESH_FAILURE_MESSAGE,
  });

  assert.equal(result.inventoryChanged, false);
  assert.equal(result.vehicleSelectionUnavailable, false);
  assert.equal(result.refreshWarning, VEHICLE_REFRESH_FAILURE_MESSAGE);
  assert.deepEqual(result.vehicleOptions, previousVehicles);
});
