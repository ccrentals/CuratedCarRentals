import assert from "node:assert/strict";
import test from "node:test";

import {
  getDefaultVehicleSecurityDepositJmd,
  normalizeAdminSettingsValue,
  resolveVehicleSecurityDepositJmd,
} from "@/lib/adminSettings";

test("getDefaultVehicleSecurityDepositJmd: resolves configured starter vehicle amounts", () => {
  assert.equal(
    getDefaultVehicleSecurityDepositJmd({
      make: "Daihatsu",
      model: "Mira ES",
      name: "Daihatsu Mira ES",
    }),
    20000,
  );
  assert.equal(
    getDefaultVehicleSecurityDepositJmd({
      make: "Subaru",
      model: "Impreza Sport",
      name: "Subaru Impreza Sport",
    }),
    20000,
  );
  assert.equal(
    getDefaultVehicleSecurityDepositJmd({
      make: "Subaru",
      model: "XV",
      name: "Subaru XV",
    }),
    25000,
  );
  assert.equal(
    getDefaultVehicleSecurityDepositJmd({
      make: "Nissan",
      model: "X-Trail",
      name: "Nissan X-Trail",
    }),
    30000,
  );
  assert.equal(
    getDefaultVehicleSecurityDepositJmd({
      make: "BMW",
      model: "2 Series Active Tourer",
      name: "BMW 218i",
    }),
    30000,
  );
});

test("resolveVehicleSecurityDepositJmd: admin override wins over default", () => {
  const settings = normalizeAdminSettingsValue({
    bookingVehicleSecurityDeposits: {
      vehicleDepositsJmd: {
        "vehicle-1": 45000,
      },
    },
  });

  assert.equal(
    resolveVehicleSecurityDepositJmd(settings, {
      id: "vehicle-1",
      make: "Subaru",
      model: "XV",
      name: "Subaru XV",
    }),
    45000,
  );
});

test("resolveVehicleSecurityDepositJmd: explicit blank disables default message", () => {
  const settings = normalizeAdminSettingsValue({
    bookingVehicleSecurityDeposits: {
      vehicleDepositsJmd: {
        "vehicle-1": null,
      },
    },
  });

  assert.equal(
    resolveVehicleSecurityDepositJmd(settings, {
      id: "vehicle-1",
      make: "Subaru",
      model: "XV",
      name: "Subaru XV",
    }),
    null,
  );
});

test("normalizeAdminSettingsValue: drops invalid security deposit amounts", () => {
  const settings = normalizeAdminSettingsValue({
    bookingVehicleSecurityDeposits: {
      vehicleDepositsJmd: {
        valid: "30000",
        empty: "",
        negative: -5,
        invalid: "abc",
      },
    },
  });

  assert.deepEqual(settings.bookingVehicleSecurityDeposits.vehicleDepositsJmd, {
    valid: 30000,
    empty: null,
    negative: null,
    invalid: null,
  });
});
