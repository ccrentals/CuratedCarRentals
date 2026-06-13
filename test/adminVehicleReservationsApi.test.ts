import assert from "node:assert/strict";
import test from "node:test";

import {
  handleVehicleReservationsGet,
  type VehicleReservationsQueryInput,
} from "@/app/api/admin/vehicles/[id]/reservations/route";
import { handleVehicleReservationsExportGet } from "@/app/api/admin/vehicles/[id]/reservations/export/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("admin vehicle reservations API: requires auth", async () => {
  const response = await handleVehicleReservationsGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/reservations`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      vehicleExists: async () => true,
      fetchReservations: async () => ({
        rows: [],
        statuses: [],
        total: 0,
        summary: {
          upcoming_count: 0,
          active_count: 0,
          completed_count: 0,
          cancelled_count: 0,
        },
      }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle reservations API: validates vehicle id", async () => {
  const response = await handleVehicleReservationsGet(
    new Request("http://localhost/api/admin/vehicles/not-a-uuid/reservations"),
    { params: Promise.resolve({ id: "not-a-uuid" }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchReservations: async () => ({
        rows: [],
        statuses: [],
        total: 0,
        summary: {
          upcoming_count: 0,
          active_count: 0,
          completed_count: 0,
          cancelled_count: 0,
        },
      }),
    },
  );

  assert.equal(response.status, 400);
});

test("admin vehicle reservations API: returns 404 when vehicle does not exist", async () => {
  let called = false;
  const response = await handleVehicleReservationsGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/reservations`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => false,
      fetchReservations: async () => {
        called = true;
        return {
          rows: [],
          statuses: [],
          total: 0,
          summary: {
            upcoming_count: 0,
            active_count: 0,
            completed_count: 0,
            cancelled_count: 0,
          },
        };
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test("admin vehicle reservations API: applies parsed filters and paging", async () => {
  let capturedInput: VehicleReservationsQueryInput | null = null;

  const response = await handleVehicleReservationsGet(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/reservations?view=history&status=confirmed&q=jane&start=2026-01-01&end=2026-01-31&limit=999&offset=-10`,
    ),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchReservations: async (input) => {
        capturedInput = input;
        return {
          rows: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              customer_name: "Jane Doe",
              customer_email: "jane@example.com",
              pickup_at: "2026-01-05T10:00:00.000Z",
              return_at: "2026-01-08T10:00:00.000Z",
              status: "CONFIRMED",
              total_cents: 123400,
              deposit_cents: 30000,
              created_at: "2025-12-20T10:00:00.000Z",
            },
          ],
          statuses: ["CONFIRMED", "RETURNED"],
          total: 1,
          summary: {
            upcoming_count: 0,
            active_count: 1,
            completed_count: 0,
            cancelled_count: 0,
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedInput, "expected parsed query input");
  const parsedInput = capturedInput as VehicleReservationsQueryInput;
  assert.equal(parsedInput.vehicleId, VEHICLE_ID);
  assert.equal(parsedInput.view, "history");
  assert.equal(parsedInput.status, "CONFIRMED");
  assert.equal(parsedInput.search, "jane");
  assert.equal(parsedInput.startDate, "2026-01-01");
  assert.equal(parsedInput.endDate, "2026-01-31");
  assert.equal(parsedInput.limit, 200);
  assert.equal(parsedInput.offset, 0);

  const body = (await response.json()) as {
    ok?: boolean;
    rows?: Array<{ id?: string; customerName?: string; status?: string }>;
    paging?: { total?: number };
    summary?: { activeCount?: number };
    statuses?: string[];
  };

  assert.equal(body.ok, true);
  assert.equal(body.rows?.[0]?.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(body.rows?.[0]?.customerName, "Jane Doe");
  assert.equal(body.rows?.[0]?.status, "CONFIRMED");
  assert.equal(body.summary?.activeCount, 1);
  assert.equal(body.paging?.total, 1);
  assert.deepEqual(body.statuses, ["CONFIRMED", "RETURNED"]);
});

test("admin vehicle reservations API: returns 400 for invalid date input", async () => {
  const response = await handleVehicleReservationsGet(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/reservations?start=2026-13-40&end=2026-01-31`,
    ),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      vehicleExists: async () => true,
      fetchReservations: async () => ({
        rows: [],
        statuses: [],
        total: 0,
        summary: {
          upcoming_count: 0,
          active_count: 0,
          completed_count: 0,
          cancelled_count: 0,
        },
      }),
    },
  );

  assert.equal(response.status, 400);
});

test("admin vehicle reservations export API: returns CSV", async () => {
  const response = await handleVehicleReservationsExportGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/reservations/export?view=history`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => null,
      fetchPage: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            rows: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                customerName: "Jane Doe",
                customerEmail: "jane@example.com",
                pickupAt: "2026-01-05T10:00:00.000Z",
                returnAt: "2026-01-08T10:00:00.000Z",
                status: "CONFIRMED",
                totalCents: 123400,
                depositCents: 30000,
                createdAt: "2025-12-20T10:00:00.000Z",
              },
            ],
            paging: { total: 1 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    },
  );

  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.match(csv, /event_id,public_id,event_type,customer_name,customer_email,pickup_at,return_at,status,total_jmd,deposit_jmd,source,active_now,impacts_availability,action_href,created_at/);
  assert.match(csv, /Jane Doe/);
});
