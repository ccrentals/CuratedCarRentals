import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleChecklistGet,
  handleAdminVehicleChecklistPost,
} from "@/app/api/admin/vehicles/[id]/checklist/route";
import { handleAdminVehicleChecklistItemPatch } from "@/app/api/admin/vehicles/[id]/checklist/[itemId]/route";
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
      resolveTemplateId: async () => null,
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
          template_id: null,
          template_key: null,
          template_expiry_required: null,
          template_expiry_warning_days: null,
          uploaded_document_id: "88888888-8888-4888-8888-888888888888",
          uploaded_document_title: "Insurance 2026.pdf",
          uploaded_document_label: "Insurance 2026",
          expiration_date: "2026-09-30",
          created_at: "2026-03-13T00:00:00.000Z",
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      ],
      resolveTemplateId: async () => null,
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
          templateId: string | null;
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
      resolveTemplateId: async () => null,
      createItem: async (vehicleId, input) => {
        createArgs = { vehicleId, input };
        return {
          id: "22222222-2222-4222-8222-222222222222",
          vehicle_id: vehicleId,
          label: input.label,
          folder: input.folder,
          required: input.required,
          allow_not_required: input.allowNotRequired,
          template_id: input.templateId,
          template_key: null,
          template_expiry_required: null,
          template_expiry_warning_days: null,
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
      templateId: null,
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

test("vehicle checklist foundation smoke: PATCH updates editable fields", async () => {
  let updateArgs:
    | {
        vehicleId: string;
        itemId: string;
        input: {
          label: string;
          folder: string;
          required: boolean;
          expirationDate: string | null;
          templateId: string | null;
        };
      }
    | null = null;

  const itemId = "99999999-9999-4999-8999-999999999999";
  const response = await handleAdminVehicleChecklistItemPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/checklist/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Updated Insurance Certificate",
        folder: "Paperwork",
        required: false,
        expirationDate: "2026-11-15",
        csrfToken: "test-token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, itemId }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      resolveTemplateId: async () => null,
      getItem: async () => ({
        id: itemId,
        vehicle_id: VEHICLE_ID,
        label: "Insurance Certificate",
        folder: "Insurance",
        required: true,
        allow_not_required: true,
        template_id: null,
        template_key: null,
        template_expiry_required: null,
        template_expiry_warning_days: null,
        uploaded_document_id: null,
        uploaded_document_title: null,
        uploaded_document_label: null,
        expiration_date: null,
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
      }),
      updateItem: async (vehicleId, updatedItemId, input) => {
        updateArgs = { vehicleId, itemId: updatedItemId, input };
        return {
          id: updatedItemId,
          vehicle_id: vehicleId,
          label: input.label,
          folder: input.folder,
          required: input.required,
          allow_not_required: true,
          template_id: null,
          template_key: null,
          template_expiry_required: null,
          template_expiry_warning_days: null,
          uploaded_document_id: null,
          uploaded_document_title: null,
          uploaded_document_label: null,
          expiration_date: input.expirationDate,
          created_at: "2026-03-13T00:00:00.000Z",
          updated_at: "2026-03-14T00:00:00.000Z",
        };
      },
      deleteItem: async () => false,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(updateArgs, {
    vehicleId: VEHICLE_ID,
    itemId,
    input: {
      label: "Updated Insurance Certificate",
      folder: "Paperwork",
      required: false,
      expirationDate: "2026-11-15",
      templateId: null,
    },
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    item?: { label?: string; folder?: string; required?: boolean; expirationDate?: string | null };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.item?.label, "Updated Insurance Certificate");
  assert.equal(payload.item?.folder, "Paperwork");
  assert.equal(payload.item?.required, false);
  assert.equal(payload.item?.expirationDate, "2026-11-15");
});

test("vehicle checklist foundation smoke: PATCH updates template identity", async () => {
  let updateArgs:
    | {
        vehicleId: string;
        itemId: string;
        input: {
          label: string;
          folder: string;
          required: boolean;
          expirationDate: string | null;
          templateId: string | null;
        };
      }
    | null = null;

  const itemId = "55555555-5555-4555-8555-555555555555";
  const response = await handleAdminVehicleChecklistItemPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/checklist/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateKey: "insurance-certificate",
        csrfToken: "test-token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, itemId }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      resolveTemplateId: async () => "66666666-6666-4666-8666-666666666666",
      getItem: async () => ({
        id: itemId,
        vehicle_id: VEHICLE_ID,
        label: "Legacy Insurance",
        folder: "Insurance",
        required: true,
        allow_not_required: true,
        template_id: null,
        template_key: null,
        template_expiry_required: null,
        template_expiry_warning_days: null,
        uploaded_document_id: null,
        uploaded_document_title: null,
        uploaded_document_label: null,
        expiration_date: null,
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-13T00:00:00.000Z",
      }),
      updateItem: async (vehicleId, updatedItemId, input) => {
        updateArgs = { vehicleId, itemId: updatedItemId, input };
        return {
          id: updatedItemId,
          vehicle_id: vehicleId,
          label: "Legacy Insurance",
          folder: input.folder,
          required: true,
          allow_not_required: true,
          template_id: input.templateId,
          template_key: "insurance-certificate",
          template_expiry_required: true,
          template_expiry_warning_days: 30,
          uploaded_document_id: null,
          uploaded_document_title: null,
          uploaded_document_label: null,
          expiration_date: null,
          created_at: "2026-03-13T00:00:00.000Z",
          updated_at: "2026-03-14T00:00:00.000Z",
        };
      },
      deleteItem: async () => false,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(updateArgs, {
    vehicleId: VEHICLE_ID,
    itemId,
    input: {
      label: "Legacy Insurance",
      folder: "Insurance",
      required: true,
      expirationDate: null,
      templateId: "66666666-6666-4666-8666-666666666666",
    },
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    item?: { templateId?: string | null; templateKey?: string | null };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.item?.templateId, "66666666-6666-4666-8666-666666666666");
  assert.equal(payload.item?.templateKey, "insurance-certificate");
});

test("vehicle checklist foundation smoke: POST resolves template identity", async () => {
  let createArgs:
    | {
        vehicleId: string;
        input: {
          label: string;
          folder: string;
          required: boolean;
          allowNotRequired: boolean;
          expirationDate: string | null;
          templateId: string | null;
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
        allowNotRequired: true,
        templateKey: "insurance-certificate",
        csrfToken: "test-token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listItems: async () => [],
      resolveTemplateId: async () => "33333333-3333-4333-8333-333333333333",
      createItem: async (vehicleId, input) => {
        createArgs = { vehicleId, input };
        return {
          id: "44444444-4444-4444-8444-444444444444",
          vehicle_id: vehicleId,
          label: input.label,
          folder: input.folder,
          required: input.required,
          allow_not_required: input.allowNotRequired,
          template_id: input.templateId,
          template_key: "insurance-certificate",
          template_expiry_required: true,
          template_expiry_warning_days: 30,
          uploaded_document_id: null,
          uploaded_document_title: null,
          uploaded_document_label: null,
          expiration_date: null,
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
      allowNotRequired: true,
      expirationDate: null,
      templateId: "33333333-3333-4333-8333-333333333333",
    },
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    item?: { templateId?: string | null; templateKey?: string | null };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.item?.templateId, "33333333-3333-4333-8333-333333333333");
  assert.equal(payload.item?.templateKey, "insurance-certificate");
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
