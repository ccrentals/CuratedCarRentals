import test from "node:test";
import assert from "node:assert/strict";

import {
  formatJmdDecimal,
  formatJmdDecimalFromMinorUnits,
  jmdAmountToMinorUnits,
  jmdMinorUnitsToAmount,
  readStoredJmdAmount,
} from "@/lib/money";
import { createExcel } from "@/app/api/admin/customers/route";

test("legacy commercial values remain whole JMD despite cents-style names", () => {
  assert.equal(readStoredJmdAmount(6500), 6500);
  assert.equal(formatJmdDecimal(6500), "6500.00");
  assert.equal(readStoredJmdAmount("11500.50"), 11500.5);
});

test("fleet accounting values explicitly convert between JMD and minor units", () => {
  assert.equal(jmdAmountToMinorUnits(6500), 650000);
  assert.equal(jmdAmountToMinorUnits("6500.25"), 650025);
  assert.equal(jmdMinorUnitsToAmount(650025), 6500.25);
  assert.equal(formatJmdDecimalFromMinorUnits(650025), "6500.25");
});

test("invalid money inputs normalize to zero at formatting boundaries", () => {
  assert.equal(readStoredJmdAmount(undefined), 0);
  assert.equal(readStoredJmdAmount("not-money"), 0);
  assert.equal(formatJmdDecimal(Number.NaN), "0.00");
});

test("customer exports preserve scale-1 commercial payment totals", () => {
  const excel = createExcel([
    {
      id: "customer-1",
      full_name: "Test Customer",
      email: "test@example.com",
      phone: "8765550100",
      created_at: "2026-01-01T00:00:00.000Z",
      last_booked_at: "2026-01-02T00:00:00.000Z",
      total_bookings: 1,
      total_spend: 123400,
    },
  ]);

  assert.match(excel, /<Data ss:Type="Number">123400\.00<\/Data>/);
  assert.doesNotMatch(excel, /<Data ss:Type="Number">1234\.00<\/Data>/);
});
