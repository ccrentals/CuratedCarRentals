import assert from "node:assert/strict";
import test from "node:test";

import {
  BookingLocationConfigSchemaError,
  getBookingLocationConfigMigrationMessage,
  listActiveBookingLocationConfigs,
  toBookingLocationConfigSchemaError,
} from "@/lib/bookings/bookingLocationConfigStore";

test("booking location config store: transforms missing phase-2 columns into a migration-required error", async () => {
  await assert.rejects(
    () =>
      listActiveBookingLocationConfigs({
        query: async () => {
          const error = new Error('column "field_schema_json" does not exist') as Error & {
            code?: string;
          };
          error.code = "42703";
          throw error;
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof BookingLocationConfigSchemaError);
      assert.equal(error.message, getBookingLocationConfigMigrationMessage());
      assert.equal(error.code, "BOOKING_LOCATION_CONFIG_MIGRATION_REQUIRED");
      assert.equal(error.status, 503);
      return true;
    },
  );
});

test("booking location config store: detects missing booking_locations relation as a schema error", () => {
  const error = new Error('relation "booking_locations" does not exist') as Error & {
    code?: string;
  };
  error.code = "42P01";

  const normalized = toBookingLocationConfigSchemaError(error);
  assert.ok(normalized instanceof BookingLocationConfigSchemaError);
  assert.equal(normalized?.message, getBookingLocationConfigMigrationMessage());
});
