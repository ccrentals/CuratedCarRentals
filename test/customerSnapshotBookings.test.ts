import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  mapCustomerSnapshotBookingRow,
  sortCustomerSnapshotBookings,
  type CustomerSnapshotBookingItem,
} from "@/lib/customers/customerSnapshotBookingView";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("customer detail layout: profile section is rendered before customer snapshot", () => {
  const pageSource = read("src/app/admin/(protected)/customers/[id]/page.tsx");
  const profileIndex = pageSource.indexOf(">Profile<");
  const snapshotIndex = pageSource.indexOf(">Customer Snapshot<");

  assert.ok(profileIndex >= 0);
  assert.ok(snapshotIndex >= 0);
  assert.ok(profileIndex < snapshotIndex);
});

test("customer snapshot booking mapping: uses public_id and falls back to id", () => {
  const withPublicId = mapCustomerSnapshotBookingRow({
    id: "11111111-1111-4111-8111-111111111111",
    public_id: "BK000334",
    start_date: "2026-03-12",
    end_date: "2026-03-15",
    created_at: "2026-03-01T08:30:00.000Z",
    status: "CONFIRMED",
    pricing_json: { total_cents: 18600, balance_due: 16740 },
    vehicle_make: "Toyota",
    vehicle_model: "Yaris",
  });
  const fallback = mapCustomerSnapshotBookingRow({
    id: "22222222-2222-4222-8222-222222222222",
    public_id: null,
    start_date: "2026-03-16",
    end_date: "2026-03-18",
    created_at: "2026-03-02T08:30:00.000Z",
    status: "PENDING_PAYMENT",
    pricing_json: { total_cents: 12000, balance_due: 12000 },
    vehicle_make: "Honda",
    vehicle_model: "Fit",
  });

  assert.equal(withPublicId.publicId, "BK000334");
  assert.equal(fallback.publicId, "22222222-2222-4222-8222-222222222222");
  assert.equal(withPublicId.totalAmount, 18600);
  assert.equal(withPublicId.balanceAmount, 16740);
  assert.equal(withPublicId.createdAtValue, "2026-03-01T08:30:00.000Z");
});

test("customer snapshot booking mapping preserves database DATE objects", () => {
  const row = mapCustomerSnapshotBookingRow({
    id: "33333333-3333-4333-8333-333333333333",
    public_id: "BK000335",
    start_date: new Date(2026, 6, 6),
    end_date: new Date(2026, 6, 15),
    created_at: "2026-03-01T08:30:00.000Z",
    status: "CONFIRMED",
    pricing_json: {},
    vehicle_make: "Nissan",
    vehicle_model: "X-Trail",
  });

  assert.equal(row.startDateValue, "2026-07-06");
  assert.equal(row.startDateLabel, "7/6/2026");
  assert.equal(row.endDateValue, "2026-07-15");
  assert.equal(row.endDateLabel, "7/15/2026");
});

test("customer snapshot booking sorting: supports booking, dates, totals, and created order", () => {
  const rows: CustomerSnapshotBookingItem[] = [
    {
      id: "1",
      publicId: "BK000120",
      vehicleLabel: "Toyota Yaris",
      startDateValue: "2026-03-20",
      startDateLabel: "3/20/2026, 12:00:00 AM",
      endDateValue: "2026-03-22",
      endDateLabel: "3/22/2026, 12:00:00 AM",
      status: "CONFIRMED",
      statusLabel: "Confirmed",
      totalAmount: 18000,
      totalLabel: "JMD 18,000.00",
      balanceAmount: 8000,
      balanceLabel: "JMD 8,000.00",
      createdAtValue: "2026-03-10T08:00:00.000Z",
      createdAtLabel: "3/10/2026, 8:00:00 AM",
    },
    {
      id: "2",
      publicId: "BK000098",
      vehicleLabel: "Honda Fit",
      startDateValue: "2026-03-12",
      startDateLabel: "3/12/2026, 12:00:00 AM",
      endDateValue: "2026-03-14",
      endDateLabel: "3/14/2026, 12:00:00 AM",
      status: "Pending Payment",
      statusLabel: "Pending Payment",
      totalAmount: 12000,
      totalLabel: "JMD 12,000.00",
      balanceAmount: 12000,
      balanceLabel: "JMD 12,000.00",
      createdAtValue: "2026-03-11T08:00:00.000Z",
      createdAtLabel: "3/11/2026, 8:00:00 AM",
    },
    {
      id: "3",
      publicId: "BK000305",
      vehicleLabel: "Nissan X-Trail",
      startDateValue: "2026-03-16",
      startDateLabel: "3/16/2026, 12:00:00 AM",
      endDateValue: "2026-03-18",
      endDateLabel: "3/18/2026, 12:00:00 AM",
      status: "Returned",
      statusLabel: "Returned",
      totalAmount: 22000,
      totalLabel: "JMD 22,000.00",
      balanceAmount: 0,
      balanceLabel: "JMD 0.00",
      createdAtValue: "2026-03-09T08:00:00.000Z",
      createdAtLabel: "3/9/2026, 8:00:00 AM",
    },
  ];

  assert.deepEqual(
    sortCustomerSnapshotBookings(rows, "booking", "asc").map((row) => row.publicId),
    ["BK000098", "BK000120", "BK000305"],
  );
  assert.deepEqual(
    sortCustomerSnapshotBookings(rows, "dates", "asc").map((row) => row.publicId),
    ["BK000098", "BK000305", "BK000120"],
  );
  assert.deepEqual(
    sortCustomerSnapshotBookings(rows, "total", "desc").map((row) => row.publicId),
    ["BK000305", "BK000120", "BK000098"],
  );
  assert.deepEqual(
    sortCustomerSnapshotBookings(rows, "created", "desc").map((row) => row.publicId),
    ["BK000098", "BK000120", "BK000305"],
  );
});

test("customer snapshot bookings table source: uses sortable headers and no longer renders an Open column", () => {
  const componentSource = read("src/components/admin/CustomerSnapshotBookingsTable.tsx");

  assert.match(componentSource, /SortableTh/);
  assert.match(componentSource, /customer-booking-public-id/);
  assert.doesNotMatch(componentSource, />Open</);
});
