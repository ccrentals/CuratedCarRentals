import assert from "node:assert/strict";
import test from "node:test";

import { getNativeAdminDashboard } from "@/app/api/admin/dashboard/route";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "OPERATIONS",
  appRole: "OPERATIONS" as const,
  authSource: "native" as const,
  clerkUserId: "user_clerk_123",
  issuedAt: 1,
  expiresAt: 2,
};

test("native dashboard returns compact operational metrics", async () => {
  const now = new Date("2026-07-21T14:00:00.000Z");
  const response = await getNativeAdminDashboard({
    authorize: async () => ({
      ok: true,
      actor,
      session: { userId: actor.userId, role: actor.role, issuedAt: 1, expiresAt: 2, source: "native" },
    }),
    now: () => now,
    loadBookings: async () => ({
      counts: { totalBookings: 22, pendingPayment: 4, confirmed: 13 },
      recentBookings: [{
        id: "booking-1",
        publicId: "BK000022",
        customerName: "A Customer",
        customerEmail: "customer@example.com",
        vehicleLabel: "2025 Suzuki Swift",
        startDateLabel: "Jul 22, 2026",
        endDateLabel: "Jul 25, 2026",
        startDateIso: "2026-07-22",
        endDateIso: "2026-07-25",
        createdAtIso: "2026-07-21T12:00:00.000Z",
        createdAtLabel: "Jul 21, 2026",
        cancelledAtLabel: null,
        lostToFirstDeposit: false,
        status: "CONFIRMED",
        statusLabel: "Confirmed",
        derivedPhase: "UPCOMING",
        substatusIndicators: [],
        overriddenByBookingId: null,
        overriddenByCustomerName: null,
      }],
      recentBookingsPagination: { page: 1, totalPages: 1, totalCount: 1, from: 1, to: 1, hasPrev: false, hasNext: false, pageSize: 5 },
      archiveNotConfigured: false,
    }),
    loadFleet: async () => [{
      id: "vehicle-1",
      public_id: "VEH000001",
      make: "Suzuki",
      model: "Swift",
      year: 2025,
      daily_rate_cents: 750000,
      deposit_cents: 2500000,
      status: "AVAILABLE",
      needs_cleaning: false,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
      deleted_at: null,
      derived_status: "AVAILABLE",
    }],
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const body = await response.json();
  assert.deepEqual(body.metrics, {
    totalBookings: 22,
    pendingPayment: 4,
    confirmedBookings: 13,
    totalVehicles: 1,
    availableVehicles: 1,
    attentionVehicles: 0,
  });
  assert.equal(body.recentBookings[0].publicId, "BK000022");
  assert.equal(body.recentVehicles[0].label, "2025 Suzuki Swift");
});

test("native dashboard preserves authorization failures", async () => {
  const response = await getNativeAdminDashboard({
    authorize: async () => ({ ok: false, reason: "unauthorized", response: new Response("Unauthorized", { status: 401 }) }),
    now: () => new Date(),
    loadBookings: async () => { throw new Error("should not run"); },
    loadFleet: async () => { throw new Error("should not run"); },
  });
  assert.equal(response.status, 401);
});
