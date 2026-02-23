import assert from "node:assert/strict";
import test from "node:test";

import {
  handleVehicleMaintenanceSchedulesGet,
  handleVehicleMaintenanceSchedulesPost,
} from "@/app/api/admin/vehicles/[id]/maintenance/schedules/route";
import { handleVehicleMaintenanceLogsPost } from "@/app/api/admin/vehicles/[id]/maintenance/logs/route";
import { handleVehicleMaintenanceAttachmentsPost } from "@/app/api/admin/vehicles/[id]/maintenance/logs/[logId]/attachments/route";
import { handleVehicleMaintenanceAttachmentDelete } from "@/app/api/admin/vehicles/[id]/maintenance/logs/[logId]/attachments/[linkId]/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_TYPE_ID = "22222222-2222-4222-8222-222222222222";
const SCHEDULE_ID = "33333333-3333-4333-8333-333333333333";
const LOG_ID = "44444444-4444-4444-8444-444444444444";
const DOC_ID = "55555555-5555-4555-8555-555555555555";
const LINK_ID = "66666666-6666-4666-8666-666666666666";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("vehicle maintenance schedules API: GET requires auth", async () => {
  const response = await handleVehicleMaintenanceSchedulesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/schedules`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listSchedules: async () => [],
      createSchedule: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 401);
});

test("vehicle maintenance schedules API: POST validates intervals", async () => {
  const response = await handleVehicleMaintenanceSchedulesPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/schedules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        serviceTypeId: SERVICE_TYPE_ID,
        intervalDays: null,
        intervalOdometer: null,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listSchedules: async () => [],
      createSchedule: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle maintenance schedules API: POST forwards normalized payload", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const response = await handleVehicleMaintenanceSchedulesPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/schedules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        serviceTypeId: SERVICE_TYPE_ID,
        intervalDays: "180",
        intervalOdometer: "8000",
        lastServiceDate: "2026-02-01",
        lastServiceOdometer: "40220",
        notes: "Engine oil interval",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listSchedules: async () => [],
      createSchedule: async (_vehicleId, payload) => {
        capturedPayload = payload as unknown as Record<string, unknown>;
        return {
          id: SCHEDULE_ID,
          vehicle_id: VEHICLE_ID,
          service_type_id: SERVICE_TYPE_ID,
          service_type_name: "Oil Change",
          interval_days: 180,
          interval_odometer: 8000,
          last_service_date: "2026-02-01",
          last_service_odometer: 40220,
          next_due_date: "2026-07-31",
          next_due_odometer: 48220,
          status: "ACTIVE",
          notes: "Engine oil interval",
          created_at: "2026-02-23T10:00:00.000Z",
          updated_at: "2026-02-23T10:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedPayload);
  const saved = capturedPayload as {
    serviceTypeId?: unknown;
    intervalDays?: unknown;
    intervalOdometer?: unknown;
  };
  assert.equal(saved.serviceTypeId, SERVICE_TYPE_ID);
  assert.equal(saved.intervalDays, 180);
  assert.equal(saved.intervalOdometer, 8000);
});

test("vehicle maintenance logs API: POST requires auth", async () => {
  const response = await handleVehicleMaintenanceLogsPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        serviceTypeId: SERVICE_TYPE_ID,
        serviceDate: "2026-02-23",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listLogs: async () => [],
      createLog: async () => null,
    },
  );

  assert.equal(response.status, 401);
});

test("vehicle maintenance attachments API: POST requires UUID document id", async () => {
  const response = await handleVehicleMaintenanceAttachmentsPost(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/logs/${LOG_ID}/attachments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": "token",
        },
        body: JSON.stringify({
          documentId: "https://ucarecdn.com/file-id/",
          csrfToken: "token",
        }),
      },
    ),
    { params: Promise.resolve({ id: VEHICLE_ID, logId: LOG_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listAttachments: async () => [],
      createAttachmentLink: async () => null,
    },
  );

  assert.equal(response.status, 400);
});

test("vehicle maintenance attachments API: POST links document by opaque UUID", async () => {
  let capturedDocumentId: string | null = null;
  const response = await handleVehicleMaintenanceAttachmentsPost(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/logs/${LOG_ID}/attachments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": "token",
        },
        body: JSON.stringify({
          documentId: DOC_ID,
          csrfToken: "token",
        }),
      },
    ),
    { params: Promise.resolve({ id: VEHICLE_ID, logId: LOG_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listAttachments: async () => [],
      createAttachmentLink: async (_vehicleId, _logId, documentId) => {
        capturedDocumentId = documentId;
        return {
          link_id: LINK_ID,
          document_id: DOC_ID,
          title: "Receipt",
          folder: "Maintenance",
          document_type: "Maintenance Receipt",
          mime_type: "application/pdf",
          size_bytes: 34567,
          created_at: "2026-02-23T12:00:00.000Z",
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedDocumentId, DOC_ID);
});

test("vehicle maintenance attachment delete API: auth required", async () => {
  const response = await handleVehicleMaintenanceAttachmentDelete(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/logs/${LOG_ID}/attachments/${LINK_ID}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": "token",
        },
        body: JSON.stringify({ csrfToken: "token" }),
      },
    ),
    { params: Promise.resolve({ id: VEHICLE_ID, logId: LOG_ID, linkId: LINK_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      deleteAttachmentLink: async () => true,
    },
  );

  assert.equal(response.status, 401);
});
