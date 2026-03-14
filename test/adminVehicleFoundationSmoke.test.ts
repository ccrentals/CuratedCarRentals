import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleChecklistGet,
  handleAdminVehicleChecklistPost,
} from "@/app/api/admin/vehicles/[id]/checklist/route";
import { handleVehicleMaintenanceGet } from "@/app/api/admin/vehicles/[id]/maintenance/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function adminSession() {
  return {
    userId: "admin-user-id",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("vehicle checklist foundation smoke: GET returns ok payload", async () => {
  const response = await handleAdminVehicleChecklistGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/checklist`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listItems: async () => [],
      createItem: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { ok?: boolean; items?: unknown[] };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items, []);
});

test("vehicle checklist foundation smoke: GET exposes attached file label", async () => {
  const response = await handleAdminVehicleChecklistGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/checklist`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listItems: async () => [
        {
          id: "77777777-7777-4777-8777-777777777777",
          vehicle_id: VEHICLE_ID,
          label: "Insurance Certificate",
          folder: "Insurance",
          required: true,
          allow_not_required: false,
          uploaded_document_id: "88888888-8888-4888-8888-888888888888",
          uploaded_document_title: "Insurance 2026.pdf",
          uploaded_document_label: "Insurance 2026",
          expiration_date: "2026-09-30",
          created_at: "2026-03-13T00:00:00.000Z",
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      ],
      createItem: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    items?: Array<{ uploadedDocumentDisplayLabel?: string | null; uploadedDocumentId?: string | null }>;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.items?.[0]?.uploadedDocumentDisplayLabel, "Insurance 2026");
  assert.equal(payload.items?.[0]?.uploadedDocumentId, "88888888-8888-4888-8888-888888888888");
});

test("vehicle checklist foundation smoke: POST persists allowNotRequired metadata", async () => {
  let createArgs:
    | {
        vehicleId: string;
        input: {
          label: string;
          folder: string;
          required: boolean;
          allowNotRequired: boolean;
          expirationDate: string | null;
        };
      }
    | null = null;

  const response = await handleAdminVehicleChecklistPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Insurance Certificate",
        folder: "Insurance",
        required: true,
        allowNotRequired: false,
        expirationDate: "2026-03-30",
        csrfToken: "test-token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listItems: async () => [],
      createItem: async (vehicleId, input) => {
        createArgs = { vehicleId, input };
        return {
          id: "22222222-2222-4222-8222-222222222222",
          vehicle_id: vehicleId,
          label: input.label,
          folder: input.folder,
          required: input.required,
          allow_not_required: input.allowNotRequired,
          uploaded_document_id: null,
          uploaded_document_title: null,
          uploaded_document_label: null,
          expiration_date: input.expirationDate,
          created_at: "2026-03-13T00:00:00.000Z",
          updated_at: "2026-03-13T00:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(createArgs, {
    vehicleId: VEHICLE_ID,
    input: {
      label: "Insurance Certificate",
      folder: "Insurance",
      required: true,
      allowNotRequired: false,
      expirationDate: "2026-03-30",
    },
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    item?: { allowNotRequired?: boolean; required?: boolean; folder?: string };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.item?.required, true);
  assert.equal(payload.item?.allowNotRequired, false);
  assert.equal(payload.item?.folder, "Insurance");
});

test("vehicle maintenance foundation smoke: GET returns ok payload", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getDueConfig: async () => ({ dueSoonDays: 14, dueSoonKm: 500 }),
      listRecords: async () => [],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok?: boolean;
    items?: unknown[];
    summary?: { totalMaintenanceCostCents?: number };
  };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items, []);
  assert.equal(payload.summary?.totalMaintenanceCostCents, 0);
});
